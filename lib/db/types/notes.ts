/**
 * Database types for the `notes` table.
 *
 * Two shapes per entity:
 *   - DbNote   — snake_case, mirrors the Postgres column names exactly.
 *                Used by the Electric collection schema (M3) and by the
 *                code generator (scripts/generate-electric-schemas.ts) to
 *                produce Zod validators.
 *   - Note     — camelCase app-level type. Converters in
 *                lib/electric/collections/notes.ts (M3) translate between
 *                the two. UI code uses Note; sync layer uses DbNote.
 */

/** @public */
export interface DbNote {
  id: string;
  org_id: string;
  user_id: string;
  title: string;
  body: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface Note {
  id: string;
  orgId: string;
  userId: string;
  title: string;
  body: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}
