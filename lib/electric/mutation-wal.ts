/**
 * Offline mutation Write-Ahead Log.
 *
 * Drop-in replacement for apiFetch on native platforms (Capacitor + Electron):
 *   1. Persists the mutation to IndexedDB/SQLite BEFORE the network call
 *      (survives crashes between request and confirmation).
 *   2. Attempts the API call.
 *   3. On success: removes from WAL.
 *   4. On network failure: leaves in WAL with a backoff timestamp; the
 *      mutation queue processor (mutation-queue-processor.ts) drains.
 *   5. On server rejection (4xx/5xx): removes from WAL and re-throws so the
 *      UI surfaces the error.
 *
 * Web does not use this path — the Service Worker (M4) intercepts fetch and
 * queues via the Background Sync API instead.
 *
 * Idempotency assumption: every mutation uses a client-generated UUID as the
 * primary key, so a retry after an ambiguous abort is safe — the server upsert
 * deduplicates.
 */

import { apiFetch } from '@/lib/api-client';
import { getCurrentOrgId } from '@/lib/contexts/OrgContext';
import {
  getPersistenceAdapter,
  type PendingMutation,
  type PersistenceAdapter,
} from './storage/persistence-adapter';

export interface WalMeta {
  table: string;
  type: 'insert' | 'update' | 'delete';
  entityId: string;
}

export async function apiFetchViaWal<T>(
  endpoint: string,
  init: RequestInit,
  meta: WalMeta,
): Promise<T | undefined> {
  const orgId = getCurrentOrgId();
  if (!orgId) {
    // No org yet — bypass the WAL (mutation can't be tagged correctly).
    return apiFetch<T>(endpoint, init);
  }

  const adapter = await getPersistenceAdapter();

  const mutation: PendingMutation = {
    id: `${meta.table}-${meta.type}-${meta.entityId}-${Date.now()}`,
    table: meta.table,
    type: meta.type,
    entityId: meta.entityId,
    orgId,
    data: init.body ? safeParse(init.body as string) : {},
    endpoint,
    method: (init.method ?? 'POST') as PendingMutation['method'],
    body: (init.body as string) ?? null,
    createdAt: new Date().toISOString(),
    retryCount: 0,
    lastError: null,
    nextRetryAt: null,
  };

  // 1. Persist to WAL before network. Dedup against existing pending mutations
  //    for the same entity (insert+update → merged update; insert+delete → drop).
  if (adapter.isAvailable) {
    try {
      await deduplicateAndSave(adapter, mutation);
    } catch (e) {
      console.error('[wal] persist failed, falling through to direct fetch:', e);
    }
  }

  // 2. Attempt the API call
  try {
    const result = await apiFetch<T>(endpoint, init);
    // 3. Success — drop from WAL
    if (adapter.isAvailable) {
      try {
        await adapter.deleteMutation(mutation.id);
      } catch {
        /* non-critical: server already has it; sync will reconcile */
      }
    }
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error';

    if (!isNetworkError(err)) {
      // 5. Server rejected — clean up + re-throw
      console.warn(`[wal] server rejected ${meta.table}.${meta.type} ${meta.entityId}: ${message}`);
      if (adapter.isAvailable) {
        try {
          await adapter.deleteMutation(mutation.id);
        } catch {
          /* non-critical */
        }
      }
      throw err;
    }

    // 4. Network error — schedule retry
    console.warn(`[wal] queued ${meta.table}.${meta.type} ${meta.entityId}: ${message}`);
    if (adapter.isAvailable) {
      try {
        await adapter.updateMutation(mutation.id, {
          retryCount: 1,
          lastError: message,
          nextRetryAt: getNextRetryTime(1),
        });
      } catch {
        /* non-critical */
      }
    }

    // Return a never-resolving promise so the TanStack DB transaction stays
    // in "persisting" state — keeps optimistic UI in place until the WAL
    // processor confirms the mutation. Without this, returning undefined
    // would commit the transaction and clear optimistic state.
    return new Promise<T>(() => {});
  }
}

function safeParse(s: string): Record<string, unknown> {
  try {
    const v = JSON.parse(s);
    return typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

async function deduplicateAndSave(adapter: PersistenceAdapter, m: PendingMutation): Promise<void> {
  const existing = (await adapter.getAllPendingMutations(m.orgId)).filter(
    (e) => e.table === m.table && e.entityId === m.entityId,
  );
  if (existing.length === 0) {
    await adapter.saveMutation(m);
    return;
  }
  const latest = existing[existing.length - 1];

  // insert + update → merge into the insert
  if (latest.type === 'insert' && m.type === 'update') {
    const merged = { ...latest.data, ...m.data };
    await adapter.updateMutation(latest.id, { data: merged, body: JSON.stringify(merged) });
    return;
  }
  // insert + delete → cancel both
  if (latest.type === 'insert' && m.type === 'delete') {
    await adapter.deleteMutation(latest.id);
    return;
  }
  // update + update → merge
  if (latest.type === 'update' && m.type === 'update') {
    const merged = { ...latest.data, ...m.data };
    await adapter.updateMutation(latest.id, {
      data: merged,
      body: JSON.stringify(merged),
      endpoint: m.endpoint,
      method: m.method,
    });
    return;
  }
  // update + delete → keep only delete
  if (latest.type === 'update' && m.type === 'delete') {
    await adapter.deleteMutation(latest.id);
    await adapter.saveMutation(m);
    return;
  }

  await adapter.saveMutation(m);
}

function isNetworkError(err: unknown): boolean {
  if (err instanceof TypeError) return true;
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    if (
      msg.includes('failed to fetch') ||
      msg.includes('network request failed') ||
      msg.includes('networkerror') ||
      msg.includes('load failed') ||
      msg.includes('timeout')
    ) {
      return true;
    }
    if (msg.includes('cancelled') || msg.includes('aborted')) {
      return typeof navigator !== 'undefined' ? !navigator.onLine : false;
    }
  }
  return false;
}

/**
 * Backoff schedule with jitter: 5s, 15s, 45s, 2min, 5min, 15min, 45min,
 * 2hr, 6hr, 18hr (capped). 10% jitter prevents thundering-herd retries.
 */
export function getNextRetryTime(retryCount: number): string {
  const baseMs = 5_000;
  const delay = baseMs * Math.pow(3, retryCount - 1);
  const max = 18 * 60 * 60 * 1000;
  const jitter = Math.random() * 0.1 * delay;
  return new Date(Date.now() + Math.min(delay + jitter, max)).toISOString();
}
