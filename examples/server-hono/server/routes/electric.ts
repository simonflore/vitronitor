/**
 * Electric shape proxy.
 *
 * Forwards GET /api/electric/shape requests to the Electric backend
 * (Cloud or self-hosted) with:
 *
 *   1. Auth verification — every request goes through withAuth
 *   2. Tenant scoping — `where: org_id = '<resolved>'` injected for org-scoped
 *      tables; `where: user_id = '<resolved>'` for user-scoped tables. Any
 *      client-supplied `where` is dropped.
 *   3. Header passthrough — electric-{offset, handle, schema, cursor, up-to-date}
 *      forwarded so the SDK can resume sync state across sessions.
 *   4. Anti-caching — strip `cache-control` and `etag` so neither CDN nor
 *      browser cache responses (cross-org leakage / stale shape handles).
 *
 * Hard-won error handling:
 *   - 304 → forward (Electric uses for conditional GETs)
 *   - 409 → forward (Electric "must-refetch" — client recreates collection)
 *   - other 4xx/5xx → 500 to client
 */

import { Hono } from 'hono';
import { withAuth, type AuthVariables } from '../middleware/auth';
import { isOrgScopedTable, isUserScopedTable } from '../../../../lib/electric/tables';
import { badRequestResponse, serverErrorResponse } from '../lib/response';

const ELECTRIC_HEADERS = [
  'electric-offset',
  'electric-handle',
  'electric-schema',
  'electric-cursor',
  'electric-up-to-date',
] as const;

// Params the proxy owns — anything else is forwarded to Electric (so
// SDK params like `cache-buster`, `log`, `replica` work transparently).
const PROXY_MANAGED_PARAMS = new Set(['table', 'where', '_org']);

function getElectricConfig() {
  return {
    apiUrl: process.env.ELECTRIC_API_URL || 'https://api.electric-sql.cloud',
    sourceId: process.env.ELECTRIC_SOURCE_ID,
    sourceSecret: process.env.ELECTRIC_SOURCE_SECRET,
  };
}

const electric = new Hono<{ Variables: AuthVariables }>();

electric.get('/shape', withAuth, async (c) => {
  const user = c.get('user');
  const orgId = c.get('orgId');

  const { apiUrl, sourceId, sourceSecret } = getElectricConfig();
  if (!sourceId || !sourceSecret) {
    return c.json(
      { ok: false, error: 'Electric sync not configured' },
      { status: 503, headers: { 'Retry-After': '3600' } },
    );
  }

  const reqUrl = new URL(c.req.url);
  const table = c.req.query('table');
  if (!table) return badRequestResponse(c, 'Missing table parameter');

  // Build Electric URL
  const electricUrl = new URL(`${apiUrl}/v1/shape`);
  electricUrl.searchParams.set('source_id', sourceId);
  electricUrl.searchParams.set('source_secret', sourceSecret);
  electricUrl.searchParams.set('table', table);

  // Forward client params except those we own.
  for (const [k, v] of reqUrl.searchParams.entries()) {
    if (!PROXY_MANAGED_PARAMS.has(k)) electricUrl.searchParams.set(k, v);
  }

  // Inject scope filter. orgId/user.id are server-resolved Supabase UUIDs,
  // so single-quote interpolation is safe.
  if (isOrgScopedTable(table)) {
    electricUrl.searchParams.set('where', `org_id = '${orgId}'`);
  } else if (isUserScopedTable(table)) {
    electricUrl.searchParams.set('where', `user_id = '${user.id}'`);
  }

  try {
    // Do NOT forward If-None-Match — we don't want Electric returning 304
    // with a stale body that contains an expired shape handle.
    const upstream = await fetch(electricUrl.toString(), {
      method: 'GET',
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    });

    const respHeaders = new Headers();
    for (const h of ELECTRIC_HEADERS) {
      const v = upstream.headers.get(h);
      if (v) respHeaders.set(h, v);
    }
    respHeaders.set('Content-Type', 'application/json');
    respHeaders.set('Cache-Control', 'no-store');
    respHeaders.set('CDN-Cache-Control', 'no-store');
    respHeaders.set('Vary', 'Accept-Encoding, Authorization, Cookie, X-Org-Id');
    respHeaders.set('X-Accel-Buffering', 'no');

    if (upstream.status === 304) {
      return new Response(null, { status: 304, headers: respHeaders });
    }
    if (upstream.status === 409) {
      const body = await upstream.text();
      return new Response(body, { status: 409, headers: respHeaders });
    }
    if (!upstream.ok) {
      console.error(
        `[electric/shape] upstream ${upstream.status} for table=${table}:`,
        await upstream.text(),
      );
      return serverErrorResponse(c, 'Electric sync error');
    }

    return new Response(upstream.body, { status: upstream.status, headers: respHeaders });
  } catch (err) {
    console.error('[electric/shape] proxy failure:', err);
    return serverErrorResponse(c, 'Failed to connect to sync service');
  }
});

export default electric;
