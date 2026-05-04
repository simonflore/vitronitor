/**
 * Generic Electric subscription hook.
 *
 * useCollection subscribes to a single Electric collection and
 * exposes typed rows + a single isReady flag that combines:
 *   - Electric's onFirstReady (initial sync complete)
 *   - subscription delivered the rows
 *
 * Use it directly when wrapping a single collection (see useNotes). For
 * multi-collection joins, compose multiple useCollection calls.
 *
 * StrictMode note: subscription is delayed one render so React doesn't
 * lose the onFirstReady callback during dev double-mount.
 */

import { useEffect, useState } from 'react';
import { useTanStackDb } from '@/lib/electric/TanStackDbProvider';

export interface ElectricCollection {
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
  collection: ElectricCollection | null,
  hookName: string,
  skip = false,
): UseCollectionResult<TRow> {
  const { isEnabled } = useTanStackDb();

  const [rows, setRows] = useState<TRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [electricReady, setElectricReady] = useState(false);

  const [isMounted, setIsMounted] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- after-mount flag (avoids subscribing during first render pass)
    setIsMounted(true);
  }, []);

  useEffect(() => {
    if (!isMounted || !isEnabled || !collection || skip) {
      if (skip) {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- clear rows when subscription is intentionally skipped
        setRows([]);
        setIsLoading(false);
      }
      return;
    }

    setIsLoading(true);
    setElectricReady(false);

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
      setElectricReady(true);
    });

    // Offline boot with cached data: treat as ready so empty-state UIs stay correct.
    if (typeof navigator !== 'undefined' && !navigator.onLine && (collection.toArray as unknown[]).length > 0) {
      setElectricReady(true);
    }

    const sub = collection.subscribeChanges(update, { includeInitialState: true });
    return () => sub.unsubscribe();
  }, [isMounted, isEnabled, collection, skip, hookName]);

  return { rows, isLoading, error, isReady: electricReady && !isLoading };
}
