/**
 * Public hook for working with notes — list, single, mutate.
 *
 * Subscribes to the Electric notes collection and converts snake_case rows
 * into the camelCase Note app type. Mutations route through the collection
 * (which routes through the WAL on native, plain apiFetch on web).
 */

import { useMemo, useCallback } from 'react';
import { useTanStackDb } from '@/lib/electric/TanStackDbProvider';
import { useCollection } from './data/useCollection';
import { dbRowToNote, type DbNoteRow } from '@/lib/electric/collections/notes';
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
    () => sub.rows.filter((r) => !r.deleted_at).map(dbRowToNote).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (notesCollection as any).insert(row);
      return id;
    },
    [notesCollection, user, orgId],
  );

  const updateNote = useCallback(
    (id: string, changes: { title?: string; body?: string }) => {
      if (!notesCollection) throw new Error('collection not ready');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (notesCollection as any).update(id, (draft: DbNoteRow) => {
        if (changes.title !== undefined) draft.title = changes.title;
        if (changes.body !== undefined) draft.body = changes.body;
      });
    },
    [notesCollection],
  );

  const deleteNote = useCallback(
    (id: string) => {
      if (!notesCollection) throw new Error('collection not ready');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (notesCollection as any).delete(id);
    },
    [notesCollection],
  );

  return { createNote, updateNote, deleteNote };
}
