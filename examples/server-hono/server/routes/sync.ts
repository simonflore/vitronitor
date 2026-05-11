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

app.get('/:table', withAuth, async (c) => {
  const table = c.req.param('table');
  if (!isOrgScopedTable(table)) {
    return badRequestResponse(c, `Unknown sync table: ${table}`);
  }

  const orgId = c.get('orgId');
  const admin = createAdminClient();
  const { data, error } = await admin.from(table).select('*').eq('org_id', orgId);

  if (error) {
    console.error(`[sync] ${table}:`, error.message);
    return serverErrorResponse(c, 'Failed to fetch sync data');
  }
  return successResponse(c, data ?? []);
});

export default app;
