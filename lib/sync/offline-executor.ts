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
 *     (404/409/410/422) so the outbox dead-letters instead of looping forever,
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
  type OfflineTransaction,
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

/**
 * Decide whether a persisted transaction can *never* succeed on replay and is
 * therefore safe to evict on load.
 *
 * This must be conservative: `@tanstack/offline-transactions` retries with no
 * cap (`DefaultRetryPolicy(Number.POSITIVE_INFINITY)`) and stamps `lastError`
 * on *every* failed attempt, so a transient network/5xx failure during an
 * outage looks identical to a permanent one once enough time passes —
 * `retryCount` and "has a lastError" tell us nothing about recoverability.
 * Evicting on those would silently discard an edit that would flush the moment
 * service returns. So we only drop transactions whose recorded error proves the
 * mutation is structurally doomed; everything else (including long-failing
 * transient edits) is preserved for retry.
 */
function isUnrecoverableTransaction(tx: OfflineTransaction): boolean {
  const err = tx.lastError;
  if (!err) return false;
  // The mutationFns raise NonRetriableError for permanent server failures; the
  // package removes those immediately, so a persisted one is anomalous (legacy
  // row / race) but still provably doomed.
  if (err.name === 'NonRetriableError') return true;
  const msg = err.message ?? '';
  // Structural outbox/serializer corruption — these re-abort the retry batch on
  // every drain and can never succeed:
  //   OutboxManager.update      -> "Transaction <id> not found"
  //   TransactionSerializer     -> "Collection with id <id> not found in registry"
  if (/transaction\s+\S+\s+not found/i.test(msg)) return true;
  if (/not found in registry/i.test(msg)) return true;
  // Permanent record-level failures the server reports for replays against a
  // deleted row (mirrors isPermanentApiError's 400 branch).
  if (/no longer exists/i.test(msg)) return true;
  return false;
}

/**
 * Prune only *unrecoverable* transactions from the outbox before the executor
 * replays them on load.
 *
 * `@tanstack/offline-transactions` hardcodes its retry policy to
 * `Number.POSITIVE_INFINITY` — there is no `maxRetries` config option, so a
 * failing transaction retries forever and never dead-letters. When the package
 * then persists the next retry via `outbox.update()`, a transaction whose
 * stored row has gone missing makes `OutboxManager.update` throw
 * `Transaction <id> not found`. That throw escapes the executor's handled-error
 * path and aborts the whole replay loop — so a single poison transaction at the
 * head of the queue starves *every* other pending mutation, regardless of which
 * record the user edits. On native/Electron the outbox is persisted, so the
 * wedge survives relaunches.
 *
 * `beforeRetry` is the package's sanctioned escape hatch: it runs inside
 * `loadPendingTransactions` on every executor start, and any transaction it
 * drops is also removed from storage. We use it to evict the
 * structurally-doomed transactions identified by `isUnrecoverableTransaction`
 * so they can't re-wedge the batch — while deliberately preserving transient
 * (network/5xx) failures so an outage never costs the user an unsynced edit.
 *
 * @internal exported for tests.
 */
export function pruneUnrecoverableTransactions(
  transactions: OfflineTransaction[],
): OfflineTransaction[] {
  const kept: OfflineTransaction[] = [];
  const dropped: OfflineTransaction[] = [];
  for (const tx of transactions) {
    if (isUnrecoverableTransaction(tx)) {
      dropped.push(tx);
    } else {
      kept.push(tx);
    }
  }
  if (dropped.length > 0) {
    console.warn(
      `[offline-executor] Pruning ${dropped.length} unrecoverable transaction(s) from the outbox`,
      dropped.map((t) => ({
        id: t.id,
        mutationFnName: t.mutationFnName,
        retryCount: t.retryCount,
        lastError: t.lastError?.message,
      })),
    );
  }
  return kept;
}

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
    // Evict structurally-doomed transactions on load so a single poison
    // transaction can't abort the retry batch and starve every other pending
    // mutation. Transient (network/5xx) failures are preserved. The package
    // retries infinitely with no max, so this hook is the only lever we have.
    // See pruneUnrecoverableTransactions.
    beforeRetry: pruneUnrecoverableTransactions,
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
 *  on retry (404/409/410/422) are dead-lettered immediately. 409 in
 *  particular is a stale-write conflict (optimistic concurrency, see the
 *  notes PATCH route) — re-sending the same captured mutation would conflict
 *  forever, so it must dead-letter rather than loop. */
function isPermanentApiError(err: unknown): boolean {
  if (!(err instanceof ApiFetchError)) return false;
  if (err.status === 404 || err.status === 409 || err.status === 410 || err.status === 422) return true;
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
            body: JSON.stringify({
              ...changesToNotePartial(m.changes as Partial<DbNoteRow>),
              // Optimistic-concurrency baseline: the row's `updated_at` as we
              // knew it when this mutation was captured. The server returns 409
              // if the row has changed since, so a stale offline edit
              // dead-letters instead of clobbering a newer value.
              baselineUpdatedAt: original.updated_at,
            }),
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
