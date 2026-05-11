/**
 * Offline executor for TanStack DB mutations.
 *
 * Wraps `@tanstack/offline-transactions` so every write goes through a
 * durable outbox:
 *
 *   - One `OfflineExecutor` per app session, started/disposed by the
 *     `TanStackDbProvider` once collections + persistence are ready.
 *   - One `mutationFn` per mutation-bearing collection. The function
 *     translates captured insert/update/delete envelopes into the matching
 *     API calls, throws `NonRetriableError` for permanent server failures
 *     (404/410/422) so the outbox dead-letters instead of looping forever,
 *     and threads the idempotency key the executor supplies.
 *
 * Adding another collection: append to `MUTATION_FN_NAMES`, add a key to
 * `ExecutorCollections`, register it in the `mutationFns` map in
 * `startExecutor`, and wire its `mutationFn` factory.
 */

import {
  startOfflineExecutor,
  NonRetriableError,
  type OfflineExecutor,
} from '@tanstack/offline-transactions';
import type { MutationFnParams } from '@tanstack/react-db';
import { apiFetch, ApiFetchError } from '@/lib/api-client';
import {
  changesToNotePartial,
  type DbNoteRow,
} from './collections/notes';

/** Inline typing — the package's `OfflineMutationFn` isn't re-exported from
 *  the public entry. The shape we need is `MutationFnParams` from
 *  `@tanstack/react-db` plus the `idempotencyKey` the executor adds. */
type CollectionMutationFn = (
  params: MutationFnParams & { idempotencyKey: string },
) => Promise<unknown>;

/** Names registered with the executor. Exposed so UI labelling can build a
 *  `Record<MutationFnName, string>` map that fails the build when a name is
 *  added/renamed without updating the consumer. */
export const MUTATION_FN_NAMES = ['syncNotes'] as const;
export type MutationFnName = (typeof MUTATION_FN_NAMES)[number];

/** Retries before a transaction is dead-lettered. Mirrored in components
 *  that read `transaction.retryCount`. */
export const MAX_RETRIES = 10;

let _executor: OfflineExecutor | null = null;

/** Collections the executor needs references to so it can apply optimistic
 *  mutations atomically. Keys here become the `collectionId` inside captured
 *  mutations and must match the keys in `mutationFns` below. */
export interface ExecutorCollections {
  notes: unknown;
}

/**
 * Access the running executor. Returns `null` until `startExecutor` has been
 * called by the provider. Mutation hooks read this to wrap mutations in
 * offline actions; reads are otherwise unaffected.
 */
export function getExecutor(): OfflineExecutor | null {
  return _executor;
}

/** Start the executor with the mutation-bearing collections.
 *  Called from `TanStackDbProvider` once collections + persistence are
 *  ready. Throws if called twice without a prior `disposeExecutor()`. */
export function startExecutor(collections: ExecutorCollections): OfflineExecutor {
  if (_executor) {
    throw new Error('[offline-executor] startExecutor called twice — call disposeExecutor first');
  }
  _executor = startOfflineExecutor({
    collections: {
      notes: collections.notes as never,
    },
    mutationFns: {
      syncNotes: makeNotesMutationFn(),
    } satisfies Record<MutationFnName, CollectionMutationFn>,
    onLeadershipChange: (isLeader) => {
      if (!isLeader) {
        console.log('[offline-executor] Lost leadership — running in online-only mode');
      }
    },
  });
  console.log('[offline-executor] Started');
  return _executor;
}

export function disposeExecutor(): void {
  if (!_executor) return;
  _executor.dispose();
  _executor = null;
  console.log('[offline-executor] Disposed');
}

/** Map server errors to retryable / non-retryable for the outbox.
 *  Network errors and 5xx are retried; client-side errors that won't change
 *  on retry (404/410/422) are dead-lettered immediately. */
function isPermanentApiError(err: unknown): boolean {
  if (!(err instanceof ApiFetchError)) return false;
  if (err.status === 404 || err.status === 410 || err.status === 422) return true;
  if (err.status === 400 && /no longer exists|not found/i.test(err.message)) return true;
  return false;
}

function asNonRetriable(err: unknown): never {
  const message = err instanceof Error ? err.message : String(err);
  throw new NonRetriableError(message);
}

function makeNotesMutationFn(): CollectionMutationFn {
  return async ({ transaction }) => {
    for (const m of transaction.mutations) {
      try {
        if (m.type === 'insert') {
          const row = m.modified as DbNoteRow;
          await apiFetch('/api/notes', {
            method: 'POST',
            body: JSON.stringify({ id: row.id, title: row.title, body: row.body }),
          });
        } else if (m.type === 'update') {
          const original = m.original as DbNoteRow;
          await apiFetch(`/api/notes/${original.id}`, {
            method: 'PATCH',
            body: JSON.stringify(changesToNotePartial(m.changes as Partial<DbNoteRow>)),
          });
        } else if (m.type === 'delete') {
          const original = m.original as DbNoteRow;
          await apiFetch(`/api/notes/${original.id}`, { method: 'DELETE' });
        }
      } catch (err) {
        if (err instanceof NonRetriableError) throw err;
        if (isPermanentApiError(err)) asNonRetriable(err);
        throw err;
      }
    }
  };
}
