/**
 * Hono auth middleware.
 *
 * Sets c.var.user and c.var.orgId on the Hono context. Downstream handlers
 * read these via c.get('user') / c.get('orgId').
 *
 * Auth sources (in order):
 *   1. Authorization: Bearer <supabase-jwt>
 *   2. (boilerplate extension point) cookie-based session for web PWAs
 *
 * Org resolution:
 *   - Reads X-Org-Id header if present and validates membership
 *   - Otherwise picks the user's first org_members row (single-org default)
 *   - Multi-org apps: drop the on_auth_user_created trigger in the migration,
 *     route X-Org-Id from the client based on user selection.
 */

import { createMiddleware } from 'hono/factory';
import type { User } from '@supabase/supabase-js';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { createAdminClient } from '../../lib/supabase-admin';
import { unauthorizedResponse, forbiddenResponse, badRequestResponse } from '../lib/response';

export type AuthVariables = {
  user: User;
  orgId: string;
  orgRole: 'owner' | 'admin' | 'member';
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const withAuth = createMiddleware<{ Variables: AuthVariables }>(async (c, next) => {
  const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    return c.json({ ok: false, error: 'Server misconfigured (Supabase env vars missing)' }, 500);
  }

  // 1. Extract Bearer token
  const authHeader = c.req.header('authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return unauthorizedResponse(c);
  }
  const token = authHeader.substring('Bearer '.length);

  // 2. Validate token with Supabase
  const supabase = createSupabaseClient(supabaseUrl, supabaseAnonKey);
  const { data: userData, error: userErr } = await supabase.auth.getUser(token);
  if (userErr || !userData.user) {
    return unauthorizedResponse(c);
  }
  const user = userData.user;

  // 3. Resolve org ID
  const requestedOrgId = c.req.header('x-org-id');
  const admin = createAdminClient();

  let orgId: string;
  let orgRole: 'owner' | 'admin' | 'member';

  if (requestedOrgId) {
    if (!UUID_RE.test(requestedOrgId)) {
      return badRequestResponse(c, 'Invalid X-Org-Id header');
    }
    const { data: membership, error } = await admin
      .from('org_members')
      .select('role')
      .eq('user_id', user.id)
      .eq('org_id', requestedOrgId)
      .maybeSingle();

    if (error) return c.json({ ok: false, error: 'DB error checking membership' }, 503);
    if (!membership) return forbiddenResponse(c, 'Not a member of the requested org');

    orgId = requestedOrgId;
    orgRole = membership.role as 'owner' | 'admin' | 'member';
  } else {
    // Single-org default: pick the user's first org.
    const { data: membership, error } = await admin
      .from('org_members')
      .select('org_id, role')
      .eq('user_id', user.id)
      .order('joined_at', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (error) return c.json({ ok: false, error: 'DB error resolving default org' }, 503);
    if (!membership) {
      // The on_auth_user_created trigger should have created one. If we reach
      // this branch the trigger likely wasn't applied (forgot db push?).
      return forbiddenResponse(c, 'No org membership for this user');
    }

    orgId = membership.org_id as string;
    orgRole = membership.role as 'owner' | 'admin' | 'member';
  }

  c.set('user', user);
  c.set('orgId', orgId);
  c.set('orgRole', orgRole);

  await next();
});
