/**
 * `/api/sync/:table` — bulk read endpoint for TanStack DB collections.
 *
 * Returns bare DB rows (snake_case) matching the schemas in
 * `lib/sync/collections/generated/`. Scope is org-only here; multi-tenancy
 * variants (per-user, per-team) extend `lib/sync/config.ts` and branch
 * below — see the sibling notes-CRUD route for the mutation side.
 *
 * Defence-in-depth: this route filters by `org_id` AND Postgres RLS scopes
 * by membership, so a misconfigured allowlist can't leak rows across orgs.
 */

import { Hono } from 'hono';
import { withAuth, type AuthVariables } from '../middleware/auth';
import {
  successResponse,
  badRequestResponse,
  serverErrorResponse,
} from '../lib/response';
import { createAdminClient } from '../../lib/supabase-admin';
import { isOrgScopedTable } from '../../../../lib/sync/config';

const app = new Hono<{ Variables: AuthVariables }>();

// Supabase / PostgREST applies a default 1000-row cap to every read; without
// paging it silently truncates large result sets (a table with > 1000 rows
// would render incompletely on the client with no error). Page through with
// `.range()` until a short page tells us we've drained the table.
//
// Every paged read MUST also be `ORDER BY id` (PK, always indexed). Postgres
// makes no ordering guarantee without ORDER BY, so back-to-back `.range()`
// calls can return overlapping or skipped rows. The `org_id` filter is applied
// per page, so stable ordering is about completeness, not tenant isolation.
const SYNC_PAGE_SIZE = 1000;
// Defensive cap so a query that somehow returns full pages forever can't loop.
const SYNC_MAX_PAGES = 200;

type RangedQuery<T> = PromiseLike<{
  data: T[] | null;
  error: { message: string } | null;
}>;

async function fetchAllPaginated<T>(
  buildPage: (from: number, to: number) => RangedQuery<T>,
): Promise<{ data: T[]; error: { message: string } | null }> {
  const all: T[] = [];
  let offset = 0;
  for (let page = 0; page < SYNC_MAX_PAGES; page++) {
    const { data, error } = await buildPage(offset, offset + SYNC_PAGE_SIZE - 1);
    if (error) return { data: [], error };
    const rows = data ?? [];
    all.push(...rows);
    if (rows.length < SYNC_PAGE_SIZE) return { data: all, error: null };
    offset += SYNC_PAGE_SIZE;
  }
  return {
    data: [],
    error: { message: `sync pagination exceeded ${SYNC_MAX_PAGES} pages` },
  };
}

app.get('/:table', withAuth, async (c) => {
  const table = c.req.param('table');
  if (!isOrgScopedTable(table)) {
    return badRequestResponse(c, `Unknown sync table: ${table}`);
  }

  const orgId = c.get('orgId');
  const admin = createAdminClient();
  const { data, error } = await fetchAllPaginated((from, to) =>
    admin.from(table).select('*').eq('org_id', orgId).order('id').range(from, to),
  );

  if (error) {
    console.error(`[sync] ${table}:`, error.message);
    return serverErrorResponse(c, 'Failed to fetch sync data');
  }
  return successResponse(c, data);
});

export default app;
