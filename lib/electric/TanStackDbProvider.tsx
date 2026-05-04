/**
 * TanStack DB provider for Electric collections.
 *
 * Holds the singleton notesCollection (and any future ones), creates them
 * once the user + orgId are known, and exposes them through useTanStackDb().
 *
 * Single-collection / single-org by design. To extend:
 *   - Multiple collections: declare each in `collections` and Promise.all
 *     the onFirstReady calls before flipping isReady. The pattern is:
 *
 *       const collections = useMemo(() => ({
 *         notes: createNotesCollection(),
 *         tags:  createTagsCollection(),
 *       }), [orgId]);
 *
 *   - Multi-org switching: listen to an "org switch" event, call
 *     cleanupCollections() (= dispose all current collections), then
 *     update the orgId; the useMemo above will then create a fresh set.
 */

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createNotesCollection, type NotesCollection } from './collections/notes';
import { setIsPersistenceLoading } from './collections/factory';
import {
  loadPersistedCollection,
  persistCollectionChanges,
} from './storage/persistence-adapter';
import { useAuth } from '@/lib/contexts/AuthContext';
import { useOrg } from '@/lib/contexts/OrgContext';

// ---------------------------------------------------------------------------
// Force-resync escape hatch
//
// Called by the collection factory when the SDK exhausts its stale-cache
// retries. We bump a "resync version" that re-runs the useMemo below to
// recreate fresh collections.
// ---------------------------------------------------------------------------

let _bumpResyncVersion: () => void = () => {};
export async function forceResync(): Promise<void> {
  console.warn('[tanstack-db] forceResync triggered');
  _bumpResyncVersion();
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

interface TanStackDbValue {
  notesCollection: NotesCollection | null;
  /** True once the provider has decided which collections to create (orgId resolved). */
  isInitialized: boolean;
  /** True once the initial Electric sync for all collections has completed. */
  isReady: boolean;
  /** True while the provider is restoring cached items into the collections. */
  isPersistenceLoading: boolean;
  /** Set when the provider is enabled (orgId resolved) — used by hooks to gate subscription. */
  isEnabled: boolean;
  /** Latest sync error (last one wins). */
  error: Error | null;
}

const TanStackDbContext = createContext<TanStackDbValue | null>(null);

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function TanStackDbProvider({ children }: { children: ReactNode }) {
  const { user, status } = useAuth();
  const { orgId } = useOrg();

  const [resyncVersion, setResyncVersion] = useState(0);
  // eslint-disable-next-line react-hooks/globals -- expose an imperative resync trigger to forceResync() callers outside React tree
  _bumpResyncVersion = () => setResyncVersion((v) => v + 1);

  const [isReady, setIsReady] = useState(false);
  const [isPersistenceLoading, setIsPersistenceLoadingState] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  // Recreate collections whenever orgId changes or a forceResync fires.
  const notesCollection = useMemo<NotesCollection | null>(() => {
    if (!user || !orgId) return null;
    return createNotesCollection();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, orgId, resyncVersion]);

  // Watchdog: if Electric hangs (network down at boot, source unreachable),
  // flip isReady after 12s so the UI stops blocking on it.
  const watchdogRef = useRef<number | null>(null);

  // Restore persisted items + register persistence listener whenever the
  // collection changes.
  useEffect(() => {
    if (!notesCollection || !orgId) return;

    let cancelled = false;
    let unsubscribe: (() => void) | null = null;

    (async () => {
      try {
        // 1) Hydrate from cache so the first paint shows local data instantly.
        setIsPersistenceLoading(true);
        setIsPersistenceLoadingState(true);
        const cached = await loadPersistedCollection<{ id: string }>(orgId, 'notes');
        for (const item of cached.values()) {
          // collection.insert under persistence-loading flag → no API call.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (notesCollection as any).insert(item);
        }
      } catch (e) {
        console.error('[tanstack-db] hydrate failed:', e);
      } finally {
        setIsPersistenceLoading(false);
        setIsPersistenceLoadingState(false);
      }

      if (cancelled) return;

      // 2) Subscribe — write incoming changes through to the persistence layer.
      const sub = notesCollection.subscribeChanges(
        () => {
          const items = (notesCollection.toArray as unknown as { id: string }[]).filter(Boolean);
          // Persist current snapshot. For a single small collection this is
          // fine; large collections should diff and persist incrementally.
          persistCollectionChanges(orgId, 'notes', items).catch((e) =>
            console.error('[tanstack-db] persist failed:', e),
          );
        },
        { includeInitialState: false },
      );
      unsubscribe = () => sub.unsubscribe();

      // 3) Mark ready after Electric reports first sync complete.
      notesCollection.onFirstReady(() => {
        if (!cancelled) setIsReady(true);
      });

      // Watchdog
      if (watchdogRef.current) window.clearTimeout(watchdogRef.current);
      watchdogRef.current = window.setTimeout(() => {
        if (!cancelled && !isReady) {
          console.warn('[tanstack-db] watchdog: Electric did not report ready in 12s');
          setIsReady(true);
        }
      }, 12_000);
    })();

    return () => {
      cancelled = true;
      if (unsubscribe) unsubscribe();
      if (watchdogRef.current) window.clearTimeout(watchdogRef.current);
      setIsReady(false);
      setError(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notesCollection, orgId]);

  const value = useMemo<TanStackDbValue>(
    () => ({
      notesCollection,
      isInitialized: status !== 'loading',
      isReady,
      isPersistenceLoading,
      isEnabled: !!notesCollection,
      error,
    }),
    [notesCollection, status, isReady, isPersistenceLoading, error],
  );

  return <TanStackDbContext.Provider value={value}>{children}</TanStackDbContext.Provider>;
}

export function useTanStackDb() {
  const ctx = useContext(TanStackDbContext);
  if (!ctx) throw new Error('useTanStackDb must be used within TanStackDbProvider');
  return ctx;
}
