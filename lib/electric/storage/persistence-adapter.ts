/**
 * Persistence adapter singleton + helpers.
 *
 * Picks the best adapter for the runtime:
 *   1. Electron: try better-sqlite3 via IPC. Fall back to IndexedDB.
 *   2. IndexedDB: web + Capacitor + Electron fallback.
 *   3. Otherwise: NoPersistenceAdapter (SSR / tests).
 *
 * Persistence failures are non-fatal — the app keeps running in-memory and
 * refetches on next reload.
 */

import { IndexedDbPersistenceAdapter } from './adapters/indexeddb-adapter';
import { NoPersistenceAdapter } from './adapters/no-persistence-adapter';
import type { PersistenceAdapter, StoredItem } from './types';

export type {
  PendingMutation,
  PersistenceAdapter,
  StoredItem,
  SyncState,
} from './types';

let adapter: PersistenceAdapter | null = null;
let initPromise: Promise<PersistenceAdapter> | null = null;

export async function getPersistenceAdapter(): Promise<PersistenceAdapter> {
  if (adapter) return adapter;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    // An Electron SQLite adapter can be plugged in here. IndexedDB is
    // sufficient on every currently supported runtime.
    const idb = new IndexedDbPersistenceAdapter();
    await idb.init();
    if (idb.isAvailable) {
      adapter = idb;
      return adapter;
    }

    console.log('[persistence] no IndexedDB available — using in-memory only');
    adapter = new NoPersistenceAdapter();
    return adapter;
  })();

  return initPromise;
}

/**
 * Persist a batch of collection changes. Failures are logged but never throw.
 */
export async function persistCollectionChanges<T extends { id: string }>(
  orgId: string,
  collectionId: string,
  items: T[],
  deletedKeys: string[] = [],
): Promise<void> {
  const a = await getPersistenceAdapter();
  if (!a.isAvailable) return;
  try {
    if (items.length) {
      const stored: StoredItem<T>[] = items.map((it) => ({ key: it.id, data: it }));
      await a.saveItems(orgId, collectionId, stored);
    }
    if (deletedKeys.length) {
      await a.deleteItems(orgId, collectionId, deletedKeys);
    }
  } catch (e) {
    console.error('[persistence] persist failed:', e);
  }
}

/**
 * Load persisted items for a collection. Returns an empty Map on miss.
 */
export async function loadPersistedCollection<T>(
  orgId: string,
  collectionId: string,
): Promise<Map<string, T>> {
  const a = await getPersistenceAdapter();
  if (!a.isAvailable) return new Map();
  try {
    return await a.getAllItems<T>(orgId, collectionId);
  } catch (e) {
    console.error('[persistence] load failed:', e);
    return new Map();
  }
}
