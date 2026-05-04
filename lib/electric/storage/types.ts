/**
 * Persistence adapter types.
 *
 * The PersistenceAdapter interface is platform-agnostic. Each platform
 * implements it differently:
 *   - web        — IndexedDB
 *   - Capacitor  — IndexedDB (via WebView) + later: SQLite for larger data
 *   - Electron   — better-sqlite3 via IPC (with IndexedDB fallback)
 *
 * All keys are scoped by orgId so multi-org apps don't leak between tenants.
 */

export interface StoredItem<T = unknown> {
  key: string;
  data: T;
}

export interface SyncState {
  /** Electric shape offset for incremental sync. */
  offset: string;
  /** Electric shape handle (resumable shape session). */
  handle: string;
  /** Last successful sync timestamp. */
  lastSyncAt: string;
}

export interface PendingMutation {
  id: string;
  table: string;
  type: 'insert' | 'update' | 'delete';
  entityId: string;
  orgId: string;
  data: Record<string, unknown>;
  endpoint: string;
  method: 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body: string | null;
  createdAt: string;
  retryCount: number;
  lastError: string | null;
  /** ISO timestamp; null = retry immediately. */
  nextRetryAt: string | null;
}

export interface PersistenceAdapter {
  readonly name: string;
  readonly isAvailable: boolean;

  init(): Promise<void>;

  // Collection items (org-scoped)
  saveItems<T>(orgId: string, collectionId: string, items: StoredItem<T>[]): Promise<void>;
  getAllItems<T>(orgId: string, collectionId: string): Promise<Map<string, T>>;
  deleteItems(orgId: string, collectionId: string, keys: string[]): Promise<void>;
  clearCollection(orgId: string, collectionId: string): Promise<void>;

  // Sync state (per org+collection)
  saveSyncState(orgId: string, collectionId: string, state: SyncState): Promise<void>;
  getSyncState(orgId: string, collectionId: string): Promise<SyncState | null>;

  // Pending mutations (org-scoped, replayed by mutation queue processor)
  saveMutation(mutation: PendingMutation): Promise<void>;
  updateMutation(id: string, patch: Partial<PendingMutation>): Promise<void>;
  deleteMutation(id: string): Promise<void>;
  getAllPendingMutations(orgId: string): Promise<PendingMutation[]>;

  // Org-wide reset (used on org switch)
  clearOrg(orgId: string): Promise<void>;
}
