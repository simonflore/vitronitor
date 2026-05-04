/**
 * IndexedDB persistence adapter.
 *
 * Stores three object stores:
 *   - items     keyPath: 'storageKey' (composite "<orgId>:<collectionId>:<itemKey>")
 *   - sync      keyPath: 'storageKey' (composite "<orgId>:<collectionId>")
 *   - mutations keyPath: 'id' (with orgId index for org-scoped queries)
 *
 * Used on:
 *   - web (always)
 *   - Capacitor (the WebView's built-in IndexedDB)
 *   - Electron (fallback when better-sqlite3 IPC fails to load)
 */

import type {
  PersistenceAdapter,
  PendingMutation,
  StoredItem,
  SyncState,
} from '../types';

const DB_NAME = 'vitronitor-electric';
const DB_VERSION = 1;
const STORE_ITEMS = 'items';
const STORE_SYNC = 'sync';
const STORE_MUTATIONS = 'mutations';

interface ItemRow {
  storageKey: string;   // `<orgId>:<collectionId>:<itemKey>`
  orgId: string;
  collectionId: string;
  itemKey: string;
  data: unknown;
}

interface SyncRow extends SyncState {
  storageKey: string;   // `<orgId>:<collectionId>`
}

function key(orgId: string, collectionId: string, itemKey?: string) {
  return itemKey ? `${orgId}:${collectionId}:${itemKey}` : `${orgId}:${collectionId}`;
}

export class IndexedDbPersistenceAdapter implements PersistenceAdapter {
  readonly name = 'indexeddb';
  isAvailable = false;
  private db: IDBDatabase | null = null;

  async init(): Promise<void> {
    if (typeof indexedDB === 'undefined') {
      this.isAvailable = false;
      return;
    }

    try {
      this.db = await this.openDb();
      this.isAvailable = true;
    } catch (e) {
      console.warn('[IndexedDb] init failed, falling back to in-memory:', e);
      this.isAvailable = false;
    }
  }

  private openDb(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_ITEMS)) {
          const items = db.createObjectStore(STORE_ITEMS, { keyPath: 'storageKey' });
          items.createIndex('byCollection', ['orgId', 'collectionId']);
        }
        if (!db.objectStoreNames.contains(STORE_SYNC)) {
          db.createObjectStore(STORE_SYNC, { keyPath: 'storageKey' });
        }
        if (!db.objectStoreNames.contains(STORE_MUTATIONS)) {
          const m = db.createObjectStore(STORE_MUTATIONS, { keyPath: 'id' });
          m.createIndex('byOrg', 'orgId');
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  private tx(stores: string[], mode: IDBTransactionMode) {
    if (!this.db) throw new Error('IndexedDb not initialized');
    return this.db.transaction(stores, mode);
  }

  private wrap<T>(req: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  // -- items --------------------------------------------------------------

  async saveItems<T>(orgId: string, collectionId: string, items: StoredItem<T>[]): Promise<void> {
    if (!items.length) return;
    const tx = this.tx([STORE_ITEMS], 'readwrite');
    const store = tx.objectStore(STORE_ITEMS);
    for (const it of items) {
      const row: ItemRow = {
        storageKey: key(orgId, collectionId, it.key),
        orgId,
        collectionId,
        itemKey: it.key,
        data: it.data,
      };
      store.put(row);
    }
    await this.txDone(tx);
  }

  async getAllItems<T>(orgId: string, collectionId: string): Promise<Map<string, T>> {
    const tx = this.tx([STORE_ITEMS], 'readonly');
    const idx = tx.objectStore(STORE_ITEMS).index('byCollection');
    const range = IDBKeyRange.only([orgId, collectionId]);
    const rows = (await this.wrap(idx.getAll(range))) as ItemRow[];
    const map = new Map<string, T>();
    for (const r of rows) map.set(r.itemKey, r.data as T);
    return map;
  }

  async deleteItems(orgId: string, collectionId: string, keys: string[]): Promise<void> {
    if (!keys.length) return;
    const tx = this.tx([STORE_ITEMS], 'readwrite');
    const store = tx.objectStore(STORE_ITEMS);
    for (const k of keys) store.delete(key(orgId, collectionId, k));
    await this.txDone(tx);
  }

  async clearCollection(orgId: string, collectionId: string): Promise<void> {
    const tx = this.tx([STORE_ITEMS], 'readwrite');
    const idx = tx.objectStore(STORE_ITEMS).index('byCollection');
    const range = IDBKeyRange.only([orgId, collectionId]);
    const rows = (await this.wrap(idx.getAll(range))) as ItemRow[];
    const store = tx.objectStore(STORE_ITEMS);
    for (const r of rows) store.delete(r.storageKey);
    await this.txDone(tx);
  }

  // -- sync state ---------------------------------------------------------

  async saveSyncState(orgId: string, collectionId: string, state: SyncState): Promise<void> {
    const tx = this.tx([STORE_SYNC], 'readwrite');
    const row: SyncRow = { ...state, storageKey: key(orgId, collectionId) };
    tx.objectStore(STORE_SYNC).put(row);
    await this.txDone(tx);
  }

  async getSyncState(orgId: string, collectionId: string): Promise<SyncState | null> {
    const tx = this.tx([STORE_SYNC], 'readonly');
    const row = (await this.wrap(tx.objectStore(STORE_SYNC).get(key(orgId, collectionId)))) as
      | SyncRow
      | undefined;
    return row ? { offset: row.offset, handle: row.handle, lastSyncAt: row.lastSyncAt } : null;
  }

  // -- pending mutations --------------------------------------------------

  async saveMutation(mutation: PendingMutation): Promise<void> {
    const tx = this.tx([STORE_MUTATIONS], 'readwrite');
    tx.objectStore(STORE_MUTATIONS).put(mutation);
    await this.txDone(tx);
  }

  async updateMutation(id: string, patch: Partial<PendingMutation>): Promise<void> {
    const tx = this.tx([STORE_MUTATIONS], 'readwrite');
    const store = tx.objectStore(STORE_MUTATIONS);
    const existing = (await this.wrap(store.get(id))) as PendingMutation | undefined;
    if (!existing) return;
    store.put({ ...existing, ...patch });
    await this.txDone(tx);
  }

  async deleteMutation(id: string): Promise<void> {
    const tx = this.tx([STORE_MUTATIONS], 'readwrite');
    tx.objectStore(STORE_MUTATIONS).delete(id);
    await this.txDone(tx);
  }

  async getAllPendingMutations(orgId: string): Promise<PendingMutation[]> {
    const tx = this.tx([STORE_MUTATIONS], 'readonly');
    const idx = tx.objectStore(STORE_MUTATIONS).index('byOrg');
    const rows = (await this.wrap(idx.getAll(IDBKeyRange.only(orgId)))) as PendingMutation[];
    rows.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return rows;
  }

  async clearOrg(orgId: string): Promise<void> {
    const tx = this.tx([STORE_ITEMS, STORE_SYNC, STORE_MUTATIONS], 'readwrite');

    // items + sync — scan and delete by orgId prefix
    const itemsStore = tx.objectStore(STORE_ITEMS);
    const allItems = (await this.wrap(itemsStore.getAll())) as ItemRow[];
    for (const r of allItems) if (r.orgId === orgId) itemsStore.delete(r.storageKey);

    const syncStore = tx.objectStore(STORE_SYNC);
    const allSync = (await this.wrap(syncStore.getAll())) as SyncRow[];
    for (const r of allSync) if (r.storageKey.startsWith(`${orgId}:`)) syncStore.delete(r.storageKey);

    const mutStore = tx.objectStore(STORE_MUTATIONS);
    const mutIdx = mutStore.index('byOrg');
    const muts = (await this.wrap(mutIdx.getAll(IDBKeyRange.only(orgId)))) as PendingMutation[];
    for (const m of muts) mutStore.delete(m.id);

    await this.txDone(tx);
  }

  private txDone(tx: IDBTransaction): Promise<void> {
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }
}
