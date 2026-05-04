/**
 * Mutation Queue Processor (native platforms only).
 *
 * Drains pending mutations written by the WAL when:
 *   - the app comes online after being offline
 *   - the periodic interval ticks
 *   - the user switches orgs
 *
 * Each mutation is replayed via apiFetch directly. On success it's removed
 * from the queue; on network failure the retryCount is incremented and the
 * next scheduled retry is computed; on server failure (4xx/5xx) it's dropped
 * (assumed unrecoverable — the WAL only retries network errors).
 */

import { apiFetch } from '@/lib/api-client';
import { getNextRetryTime } from './mutation-wal';
import { getPersistenceAdapter } from './storage/persistence-adapter';

const POLL_INTERVAL_MS = 30_000;
const MAX_RETRIES = 10;

let _interval: ReturnType<typeof setInterval> | null = null;
let _draining = false;

export async function drainPendingMutations(orgId: string): Promise<void> {
  if (_draining) return;
  _draining = true;

  try {
    const adapter = await getPersistenceAdapter();
    if (!adapter.isAvailable) return;

    const now = new Date().toISOString();
    const pending = (await adapter.getAllPendingMutations(orgId)).filter(
      (m) => m.nextRetryAt === null || m.nextRetryAt <= now,
    );
    if (pending.length === 0) return;

    for (const m of pending) {
      try {
        await apiFetch(m.endpoint, {
          method: m.method,
          ...(m.body && {
            headers: { 'Content-Type': 'application/json' },
            body: m.body,
          }),
        });
        await adapter.deleteMutation(m.id);
      } catch (e) {
        const message = e instanceof Error ? e.message : 'unknown';
        const isNetwork =
          e instanceof TypeError ||
          (e instanceof Error && /failed to fetch|network|timeout|load failed/i.test(e.message));

        if (!isNetwork) {
          console.warn(`[queue] dropping unrecoverable mutation ${m.id}: ${message}`);
          await adapter.deleteMutation(m.id);
          continue;
        }

        const next = m.retryCount + 1;
        if (next > MAX_RETRIES) {
          console.warn(`[queue] dropping ${m.id} after ${MAX_RETRIES} retries`);
          await adapter.deleteMutation(m.id);
          continue;
        }
        await adapter.updateMutation(m.id, {
          retryCount: next,
          lastError: message,
          nextRetryAt: getNextRetryTime(next),
        });
      }
    }
  } finally {
    _draining = false;
  }
}

export function startMutationQueueProcessor(getOrgId: () => string | null): () => void {
  // Online listener
  const onOnline = () => {
    const orgId = getOrgId();
    if (orgId) drainPendingMutations(orgId).catch((e) => console.error('[queue] drain failed:', e));
  };
  if (typeof window !== 'undefined') window.addEventListener('online', onOnline);

  // Periodic poll
  _interval = setInterval(() => {
    const orgId = getOrgId();
    if (orgId) drainPendingMutations(orgId).catch((e) => console.error('[queue] tick failed:', e));
  }, POLL_INTERVAL_MS);

  // Initial pass
  const orgId = getOrgId();
  if (orgId) drainPendingMutations(orgId).catch((e) => console.error('[queue] initial drain failed:', e));

  return () => {
    if (typeof window !== 'undefined') window.removeEventListener('online', onOnline);
    if (_interval) clearInterval(_interval);
    _interval = null;
  };
}
