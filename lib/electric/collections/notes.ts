/**
 * Notes Electric collection.
 *
 * The canonical "add a new collection" recipe — copy this file when adding
 * another table:
 *
 *   1. Re-export the generated Zod schema (or write one by hand for tiny tables).
 *   2. Write dbRowToX / xToDbRow converters (snake_case ⇄ camelCase).
 *   3. Call createOrgScopedCollection<DbXRow>({ table, schema, ... }).
 *
 * The factory handles all of: shape URL, auth headers, X-Org-Id, mutation
 * routing through the WAL, error handling (401/403/409/stale cache), and
 * key extraction.
 */

import { dbNoteRowSchema, type DbNoteRow } from './generated/note.generated';
import { createOrgScopedCollection, type WalParams } from './factory';
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

function changesToNotePartial(changes: Partial<DbNoteRow>): Partial<Note> {
  const out: Partial<Note> = {};
  if (changes.title !== undefined) out.title = changes.title;
  if (changes.body !== undefined) out.body = changes.body;
  return out;
}

export function createNotesCollection() {
  return createOrgScopedCollection<DbNoteRow>({
    table: 'notes',
    schema: dbNoteRowSchema,

    // No-op handlers (mutations always go through the WAL params below).
    onInsert: async () => {
      /* unused — getInsertWalParams handles this */
    },
    onUpdate: async () => {
      /* unused — getUpdateWalParams handles this */
    },
    onDelete: async () => {
      /* unused — getDeleteWalParams handles this */
    },

    getInsertWalParams: (row): WalParams => ({
      endpoint: '/api/notes',
      method: 'POST',
      body: { id: row.id, title: row.title, body: row.body } as Record<string, unknown>,
    }),

    getUpdateWalParams: (original, changes): WalParams => ({
      endpoint: `/api/notes/${original.id}`,
      method: 'PATCH',
      body: changesToNotePartial(changes) as Record<string, unknown>,
    }),

    getDeleteWalParams: (original): WalParams => ({
      endpoint: `/api/notes/${original.id}`,
      method: 'DELETE',
      body: null,
    }),
  });
}

export type NotesCollection = ReturnType<typeof createNotesCollection>;
