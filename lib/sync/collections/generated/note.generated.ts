/**
 * Generated Zod schema for the `notes` table.
 *
 * Kept in sync with `lib/db/types/notes.ts` → `DbNote` by
 * `scripts/generate-schemas.ts`.
 *
 * @public — knip preserves this file even if no static import is found,
 * because the sync runtime resolves it dynamically by table name.
 */

import { z } from 'zod';

export const dbNoteRowSchema = z.object({
  id: z.string(),
  org_id: z.string(),
  user_id: z.string(),
  title: z.string(),
  body: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
  deleted_at: z.string().nullish(),
});

export type DbNoteRow = z.infer<typeof dbNoteRowSchema>;
