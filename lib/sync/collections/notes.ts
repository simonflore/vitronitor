/**
 * Notes sync collection.
 *
 * The canonical "add a new collection" recipe — copy this file when adding
 * another table:
 *
 *   1. Re-export the generated Zod schema (or write one by hand for tiny tables).
 *   2. Write dbRowToX / xToDbRow converters (snake_case ⇄ camelCase).
 *   3. Call createOrgScopedCollection<DbXRow>({ table, schema, ... }).
 *
 * Writes flow through the offline executor (see `../offline-executor.ts`),
 * which wraps the per-collection `mutationFn` registered there. The
 * `onInsert`/`onUpdate`/`onDelete` handlers below are the direct-write
 * fallback for callers that invoke `collection.insert/update/delete` outside
 * an offline action.
 */

import { dbNoteRowSchema, type DbNoteRow } from './generated/note.generated';
import { createOrgScopedCollection, type CollectionConfig } from './factory';
import { apiFetch } from '@/lib/api-client';
import type { Note, DbNote } from '@/lib/db/types/notes';

export { dbNoteRowSchema };
export type { DbNoteRow };

export function dbRowToNote(row: DbNoteRow): Note {
  return {
    id: row.id,
    orgId: row.org_id,
    userId: row.user_id,
    title: row.title,
    body: row.body,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at ?? null,
  };
}

export function noteToDbRow(note: Partial<Note> & { id: string }): Partial<DbNote> {
  const row: Partial<DbNote> = { id: note.id };
  if (note.orgId !== undefined) row.org_id = note.orgId;
  if (note.userId !== undefined) row.user_id = note.userId;
  if (note.title !== undefined) row.title = note.title;
  if (note.body !== undefined) row.body = note.body;
  return row;
}

export function changesToNotePartial(changes: Partial<DbNoteRow>): Partial<Note> {
  const out: Partial<Note> = {};
  if (changes.title !== undefined) out.title = changes.title;
  if (changes.body !== undefined) out.body = changes.body;
  return out;
}

const notesConfig: CollectionConfig<DbNoteRow> = {
  table: 'notes',
  schema: dbNoteRowSchema,

  onInsert: async (row) => {
    await apiFetch('/api/notes', {
      method: 'POST',
      body: JSON.stringify({ id: row.id, title: row.title, body: row.body }),
    });
  },

  onUpdate: async (original, changes) => {
    await apiFetch(`/api/notes/${original.id}`, {
      method: 'PATCH',
      body: JSON.stringify(changesToNotePartial(changes)),
    });
  },

  onDelete: async (original) => {
    await apiFetch(`/api/notes/${original.id}`, { method: 'DELETE' });
  },
};

export function createNotesCollection() {
  return createOrgScopedCollection<DbNoteRow>(notesConfig);
}

export type NotesCollection = ReturnType<typeof createNotesCollection>;
