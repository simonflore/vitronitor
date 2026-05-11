/**
 * TanStack DB provider.
 *
 * Lifecycle:
 *   1. Opens a per-user SQLite database — OPFS-backed wa-sqlite on web and
 *      Electron renderer (relies on Electron registering the `app://` scheme
 *      so OPFS gets a real origin), `@capacitor-community/sqlite` via
 *      TanStack's Capacitor adapter on iOS/Android.
 *   2. Hands the persistence handle to `lib/sync/collections/factory.ts`
 *      via `setPersistence`. Memoised collections are created once the
 *      auth + org + persistence triple is ready.
 *   3. Starts the offline executor (`./offline-executor.ts`) so writes
 *      route through the durable outbox.
 *   4. Mounts `<BroadcastListener>` so Supabase Realtime `change` events
 *      invalidate the matching TanStack Query keys.
 *   5. On logout / user-switch: disposes the executor, cleans up collections,
 *      clears the QueryClient cache, and closes the SQLite handle (iOS keeps
 *      the WAL journal locked otherwise).
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
import type { PersistedCollectionPersistence } from '@tanstack/browser-db-sqlite-persistence';
import { createNotesCollection, type NotesCollection } from './collections/notes';
import { setPersistence as setFactoryPersistence } from './collections/factory';
import { startExecutor, disposeExecutor } from './offline-executor';
import { BroadcastListener } from '@/lib/realtime/broadcast-listener';
import { queryClient } from '@/lib/query-client';
import { useAuth } from '@/lib/contexts/AuthContext';
import { useOrg } from '@/lib/contexts/OrgContext';

// ---------------------------------------------------------------------------
// Platform-aware persistence open
// ---------------------------------------------------------------------------

interface OpenedPersistence {
  persistence: PersistedCollectionPersistence;
  /**
   * Close the underlying DB handle. iOS keeps the WAL journal open with an
   * exclusive lock until close(); leaking it across logout/re-login causes
   * the next `sqlite.createConnection` for the same user to fail or to open
   * a second connection to the same file.
   */
  close: () => Promise<void>;
}

async function openPersistence(userId: string): Promise<OpenedPersistence> {
  const isCapacitor =
    typeof window !== 'undefined' &&
    (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor
      ?.isNativePlatform?.() === true;

  if (isCapacitor) {
    const [{ CapacitorSQLite, SQLiteConnection }, { createCapacitorSQLitePersistence }] =
      await Promise.all([
        import('@capacitor-community/sqlite'),
        import('@tanstack/capacitor-db-sqlite-persistence'),
      ]);
    const sqlite = new SQLiteConnection(CapacitorSQLite);
    const dbName = `vitronitor-${userId}`;
    // An OTA reload can swap the WebView without restarting the native
    // SQLite plugin. The new JS context has an empty SQLiteConnection
    // registry, but native may still hold the previous connection — close
    // it before re-creating to avoid an "already open" error.
    await sqlite.closeConnection(dbName, false).catch(() => {
      /* no stale connection — fine */
    });
    const db = await sqlite.createConnection(dbName, false, 'no-encryption', 1, false);
    await db.open();
    return {
      persistence: createCapacitorSQLitePersistence({ database: db }),
      close: async () => {
        try {
          await db.close();
        } finally {
          // Release the connection slot in the plugin registry so a
          // re-login can call createConnection again.
          await sqlite.closeConnection(dbName, false).catch(() => {});
        }
      },
    };
  }

  // Web + Electron renderer (Electron registers `app://` so OPFS has a
  // real origin — see electron/main/index.ts).
  const { openBrowserWASQLiteOPFSDatabase, createBrowserWASQLitePersistence } = await import(
    '@tanstack/browser-db-sqlite-persistence'
  );
  const db = await openBrowserWASQLiteOPFSDatabase({ databaseName: `vitronitor-${userId}.db` });
  return {
    persistence: createBrowserWASQLitePersistence({ database: db }),
    close: async () => {
      const maybeClose = (db as unknown as { close?: () => Promise<void> | void }).close;
      if (typeof maybeClose === 'function') {
        await maybeClose.call(db);
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

interface TanStackDbContextValue {
  notesCollection: NotesCollection | null;
  /** True once `openPersistence` resolved (or fell back to memory-only). */
  persistenceReady: boolean;
  /** Set if persistence open failed entirely. UI can still operate in
   *  memory-only mode; persistence layer is just absent. */
  error: Error | null;
}

const defaultContext: TanStackDbContextValue = {
  notesCollection: null,
  persistenceReady: false,
  error: null,
};

const TanStackDbContext = createContext<TanStackDbContextValue>(defaultContext);

// ---------------------------------------------------------------------------
// Singleton collection cache
// ---------------------------------------------------------------------------

interface CachedCollections {
  notes: NotesCollection | null;
}

const NULL_COLLECTIONS: CachedCollections = { notes: null };

let cachedCollections: CachedCollections = { ...NULL_COLLECTIONS };
let collectionsCreated = false;
let collectionsError: Error | null = null;

function getOrCreateCollections(
  orgReady: boolean,
  persistenceReady: boolean,
): CachedCollections {
  if (!orgReady) return NULL_COLLECTIONS;
  // Collections must not be created before setFactoryPersistence has run —
  // the factory throws otherwise.
  if (!persistenceReady) return NULL_COLLECTIONS;
  if (collectionsCreated) return cachedCollections;

  try {
    cachedCollections = { notes: createNotesCollection() };
    collectionsCreated = true;
    console.log('[sync] Collections created');
    return cachedCollections;
  } catch (err) {
    console.error('[sync] Failed to create collections:', err);
    collectionsError = err instanceof Error ? err : new Error('Failed to initialize TanStack DB');
    collectionsCreated = true;
    return cachedCollections;
  }
}

function resetCollections(): void {
  if (!collectionsCreated) return;
  console.log('[sync] Resetting collections');
  cachedCollections = { ...NULL_COLLECTIONS };
  collectionsCreated = false;
  collectionsError = null;
}

/** Tear down active collections (disposes the executor) then clear the
 *  singleton. Use on soft-navigation logout where JS stays alive. */
async function cleanupCollections(): Promise<void> {
  if (!collectionsCreated) return;
  console.log('[sync] Cleaning up collections');
  // Dispose the offline executor BEFORE collection cleanup — pending outbox
  // transactions reference collections by name and the executor's leader
  // election + storage handles need an orderly shutdown.
  disposeExecutor();
  const notes = cachedCollections.notes;
  if (notes) {
    await (notes as unknown as { cleanup: () => Promise<void> }).cleanup().catch(() => {});
  }
  resetCollections();
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function TanStackDbProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { orgId } = useOrg();
  const orgReady = user !== null && !!orgId;

  // Persistence is async (OPFS / Capacitor SQLite). Collections gate on it
  // because the factory throws if persistence isn't set yet.
  const [persistenceReady, setPersistenceReady] = useState(false);
  const [persistenceError, setPersistenceError] = useState<Error | null>(null);

  // Track which user we opened persistence for so a subsequent login as a
  // different user triggers a fresh open instead of reusing the previous
  // user's SQLite handle.
  const openedForUserRef = useRef<string | null>(null);
  // Hold the close() returned by openPersistence so we can release the
  // SQLite handle on logout/user-switch. Without this, iOS keeps the WAL
  // journal locked and a re-login fails to reopen the same DB file.
  const closePersistenceRef = useRef<(() => Promise<void>) | null>(null);
  // Strict-mode-safe: cache the in-flight open so the double-mount doesn't
  // start two opens for the same user.
  const inFlightOpenRef = useRef<{
    userId: string;
    promise: Promise<OpenedPersistence | null>;
  } | null>(null);

  useEffect(() => {
    // Tear down stale persistence when auth changes (logout, different user).
    if (!user) {
      if (openedForUserRef.current !== null) {
        setFactoryPersistence(null);
        // Clear the in-memory cache so a different user logging in next
        // doesn't see the previous user's [table, ...] queries. Per-user
        // .db scoping handles persistence; this handles the cache.
        queryClient.clear();
        const close = closePersistenceRef.current;
        closePersistenceRef.current = null;
        openedForUserRef.current = null;
        inFlightOpenRef.current = null;
        setPersistenceReady(false);
        setPersistenceError(null);
        // Async: drop collections + executor before close so nothing is
        // holding the DB handle open.
        void cleanupCollections().then(() => {
          if (close) {
            close().catch((err) => {
              console.warn('[sync] Error closing persistence:', err);
            });
          }
        });
      }
      return;
    }

    // User changed without an explicit logout — clear the cache before
    // opening the new user's .db so the new user starts clean.
    if (openedForUserRef.current !== null && openedForUserRef.current !== user.id) {
      queryClient.clear();
    }

    // Already opened for this user — don't re-fire (Strict-Mode remount).
    if (openedForUserRef.current === user.id) return;

    const PERSISTENCE_OPEN_TIMEOUT_MS = 8_000;
    const userId = user.id;

    if (!inFlightOpenRef.current || inFlightOpenRef.current.userId !== userId) {
      const promise = Promise.race([
        openPersistence(userId).then(
          (opened) => opened as OpenedPersistence | null,
          (err) => {
            console.error('[sync] Failed to open persistence:', err);
            return null;
          },
        ),
        new Promise<null>((resolve) =>
          setTimeout(() => {
            console.warn(
              `[sync] Persistence open exceeded ${PERSISTENCE_OPEN_TIMEOUT_MS}ms — falling back to memory-only mode (no offline cache between sessions)`,
            );
            resolve(null);
          }, PERSISTENCE_OPEN_TIMEOUT_MS),
        ),
      ]);
      inFlightOpenRef.current = { userId, promise };
    }

    void inFlightOpenRef.current.promise.then((opened) => {
      // Another resolution already won — bail.
      if (openedForUserRef.current === userId) return;
      if (opened) {
        setFactoryPersistence(opened.persistence);
        closePersistenceRef.current = opened.close;
        console.log('[sync] Persistence opened');
      } else {
        setFactoryPersistence(null);
        closePersistenceRef.current = null;
      }
      openedForUserRef.current = userId;
      setPersistenceReady(true);
      setPersistenceError(null);
    });
  }, [user]);

  const collections = useMemo(
    () => getOrCreateCollections(orgReady, persistenceReady),
    [orgReady, persistenceReady],
  );
  const error = persistenceError ?? collectionsError;

  // Start the offline executor once the notes collection is ready.
  useEffect(() => {
    if (!collections.notes) return;
    try {
      startExecutor({ notes: collections.notes });
    } catch (err) {
      // Already started (Strict-Mode double-invoke). Safe to ignore.
      console.log(
        '[sync] Executor start skipped:',
        err instanceof Error ? err.message : err,
      );
    }
  }, [collections.notes]);

  const contextValue = useMemo<TanStackDbContextValue>(
    () => ({
      notesCollection: collections.notes,
      persistenceReady,
      error,
    }),
    [collections.notes, persistenceReady, error],
  );

  return (
    <TanStackDbContext.Provider value={contextValue}>
      <BroadcastListener />
      {children}
    </TanStackDbContext.Provider>
  );
}

export function useTanStackDb(): TanStackDbContextValue {
  return useContext(TanStackDbContext);
}

export type { DbNoteRow } from './collections/notes';
