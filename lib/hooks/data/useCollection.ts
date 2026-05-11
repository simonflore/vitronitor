/**
 * Generic TanStack DB subscription hook.
 *
 * Subscribes to a single sync collection and exposes typed rows + an
 * `isReady` flag that combines:
 *   - the collection's `onFirstReady` (initial sync complete)
 *   - whether the subscription has delivered rows
 *
 * Use it directly when wrapping a single collection (see `useNotes`). For
 * multi-collection joins, compose multiple `useCollection` calls.
 *
 * Strict-Mode note: subscription is delayed one render so React doesn't lose
 * the `onFirstReady` callback during dev double-mount.
 */

import { useEffect, useState } from 'react';
import { useTanStackDb } from '@/lib/sync/TanStackDbProvider';

export interface SyncCollection {
  toArray: unknown;
  subscribeChanges: (
    callback: () => void,
    options: { includeInitialState: boolean },
  ) => { unsubscribe: () => void };
  onFirstReady: (callback: () => void) => void;
}

export interface UseCollectionResult<TRow> {
  rows: TRow[];
  isLoading: boolean;
  error: Error | null;
  isReady: boolean;
}

export function useCollection<TRow>(
  collection: SyncCollection | null,
  hookName: string,
  skip = false,
): UseCollectionResult<TRow> {
  const { persistenceReady } = useTanStackDb();

  const [rows, setRows] = useState<TRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [firstReady, setFirstReady] = useState(false);

  const [isMounted, setIsMounted] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- after-mount flag (avoids subscribing during first render pass)
    setIsMounted(true);
  }, []);

  useEffect(() => {
    if (!isMounted || !persistenceReady || !collection || skip) {
      if (skip) {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- clear rows when subscription is intentionally skipped
        setRows([]);
        setIsLoading(false);
      }
      return;
    }

    setIsLoading(true);
    setFirstReady(false);

    const update = () => {
      try {
        setRows(collection.toArray as TRow[]);
        setIsLoading(false);
        setError(null);
      } catch (e) {
        console.error(`[${hookName}] read collection failed:`, e);
        setError(e instanceof Error ? e : new Error('read failed'));
        setIsLoading(false);
      }
    };

    collection.onFirstReady(() => {
      setFirstReady(true);
    });

    // Offline boot with cached data: treat as ready so empty-state UIs stay correct.
    if (typeof navigator !== 'undefined' && !navigator.onLine && (collection.toArray as unknown[]).length > 0) {
      setFirstReady(true);
    }

    const sub = collection.subscribeChanges(update, { includeInitialState: true });
    return () => sub.unsubscribe();
  }, [isMounted, persistenceReady, collection, skip, hookName]);

  return { rows, isLoading, error, isReady: firstReady && !isLoading };
}
