/**
 * Public hook for working with notes — list, single, mutate.
 *
 * Subscribes to the `notes` sync collection and converts snake_case rows
 * into the camelCase `Note` app type. Mutations are wrapped in
 * `executor.createOfflineAction` so writes persist to the outbox first;
 * the executor drains on reconnect and survives app crashes between.
 */

import { useMemo, useCallback } from 'react';
import { useTanStackDb } from '@/lib/sync/TanStackDbProvider';
import { getExecutor } from '@/lib/sync/offline-executor';
import { useCollection } from './data/useCollection';
import { dbRowToNote, type DbNoteRow } from '@/lib/sync/collections/notes';
import { useAuth } from '@/lib/contexts/AuthContext';
import { useOrg } from '@/lib/contexts/OrgContext';
import type { Note } from '@/lib/db/types/notes';

function uuid(): string {
  // crypto.randomUUID is available in all modern browsers + Node 19+.
  return crypto.randomUUID();
}

export function useNotes() {
  const { notesCollection } = useTanStackDb();
  const sub = useCollection<DbNoteRow>(notesCollection, 'useNotes');

  const notes = useMemo<Note[]>(
    () =>
      sub.rows
        .filter((r) => !r.deleted_at)
        .map(dbRowToNote)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [sub.rows],
  );

  return { notes, isLoading: sub.isLoading, isReady: sub.isReady, error: sub.error };
}

export function useNote(id: string | undefined) {
  const { notes, ...rest } = useNotes();
  const note = useMemo(() => notes.find((n) => n.id === id) ?? null, [notes, id]);
  return { note, ...rest };
}

export function useNoteMutations() {
  const { notesCollection } = useTanStackDb();
  const { user } = useAuth();
  const { orgId } = useOrg();

  // Wrap each mutation in an offline action so it persists to the executor's
  // outbox before reaching the network. The executor drains pending actions
  // on reconnect; if the app crashes mid-flight, the action replays on next
  // boot. Falls back to a direct collection write if the executor hasn't
  // started yet (e.g. during the first render before the provider's effect
  // has fired) — the factory's onInsert/Update/Delete handles that path.
  const insertAction = useMemo(() => {
    const executor = getExecutor();
    if (!notesCollection || !executor) return null;
    return executor.createOfflineAction<DbNoteRow>({
      mutationFnName: 'syncNotes',
      onMutate: (row) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (notesCollection as any).insert(row);
      },
    });
  }, [notesCollection]);

  const updateAction = useMemo(() => {
    const executor = getExecutor();
    if (!notesCollection || !executor) return null;
    return executor.createOfflineAction<{ id: string; changes: Partial<DbNoteRow> }>({
      mutationFnName: 'syncNotes',
      onMutate: ({ id, changes }) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (notesCollection as any).update(id, (draft: DbNoteRow) => {
          if (changes.title !== undefined) draft.title = changes.title;
          if (changes.body !== undefined) draft.body = changes.body;
          draft.updated_at = new Date().toISOString();
        });
      },
    });
  }, [notesCollection]);

  const deleteAction = useMemo(() => {
    const executor = getExecutor();
    if (!notesCollection || !executor) return null;
    return executor.createOfflineAction<{ id: string }>({
      mutationFnName: 'syncNotes',
      onMutate: ({ id }) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (notesCollection as any).delete(id);
      },
    });
  }, [notesCollection]);

  const createNote = useCallback(
    (input: { title?: string; body?: string } = {}) => {
      if (!notesCollection || !user || !orgId) {
        throw new Error('not signed in (or not in an org)');
      }
      const id = uuid();
      const now = new Date().toISOString();
      const row: DbNoteRow = {
        id,
        org_id: orgId,
        user_id: user.id,
        title: input.title ?? 'Untitled',
        body: input.body ?? '',
        created_at: now,
        updated_at: now,
        deleted_at: null,
      };
      if (insertAction) {
        insertAction(row);
      } else {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (notesCollection as any).insert(row);
      }
      return id;
    },
    [notesCollection, user, orgId, insertAction],
  );

  const updateNote = useCallback(
    (id: string, changes: { title?: string; body?: string }) => {
      if (!notesCollection) throw new Error('collection not ready');
      if (updateAction) {
        updateAction({ id, changes });
      } else {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (notesCollection as any).update(id, (draft: DbNoteRow) => {
          if (changes.title !== undefined) draft.title = changes.title;
          if (changes.body !== undefined) draft.body = changes.body;
          draft.updated_at = new Date().toISOString();
        });
      }
    },
    [notesCollection, updateAction],
  );

  const deleteNote = useCallback(
    (id: string) => {
      if (!notesCollection) throw new Error('collection not ready');
      if (deleteAction) {
        deleteAction({ id });
      } else {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (notesCollection as any).delete(id);
      }
    },
    [notesCollection, deleteAction],
  );

  return { createNote, updateNote, deleteNote };
}
