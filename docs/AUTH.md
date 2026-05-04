# Auth seam (`withAuth`)

The `examples/server-hono/server/middleware/auth.ts` middleware is the contract between the
auth provider and the rest of the API. Replace this one file to swap
Supabase for Clerk / Auth.js / Auth0 / Cognito / a hand-rolled JWT setup.

## What it does

```
HTTP request
   │
   ▼
withAuth middleware
   ├─ extract Bearer JWT from Authorization header
   │  (optionally: cookie auth, API keys)
   ├─ validate JWT against the auth provider
   ├─ resolve orgId from X-Org-Id header (if multi-org)
   │  OR pick the user's first org_members row (single-org default)
   ├─ on failure: 401 / 403 / 503 with the response envelope
   └─ on success: c.set('user', user); c.set('orgId', orgId); next()
```

Downstream handlers read `c.get('user')` + `c.get('orgId')`.

## Swap recipes

### Clerk

```ts
import { verifyToken } from '@clerk/backend';

export const withAuth = createMiddleware<{ Variables: AuthVariables }>(async (c, next) => {
  const token = c.req.header('authorization')?.replace('Bearer ', '');
  if (!token) return unauthorizedResponse(c);

  try {
    const claims = await verifyToken(token, { secretKey: process.env.CLERK_SECRET_KEY! });
    const user = { id: claims.sub, email: claims.email };
    // resolve orgId — Clerk has org tokens with org_id baked in
    const orgId = claims.org_id ?? (await fetchUserDefaultOrgId(claims.sub));
    if (!orgId) return forbiddenResponse(c, 'No org membership');

    c.set('user', user);
    c.set('orgId', orgId);
    await next();
  } catch {
    return unauthorizedResponse(c);
  }
});
```

### Auth.js (formerly NextAuth)

```ts
import { decode } from 'next-auth/jwt';

export const withAuth = createMiddleware<{ Variables: AuthVariables }>(async (c, next) => {
  // Auth.js uses session cookies in browser; the SPA / native app would
  // typically pass a session JWT explicitly via Authorization.
  const token = c.req.header('authorization')?.replace('Bearer ', '');
  if (!token) return unauthorizedResponse(c);

  const payload = await decode({ token, secret: process.env.AUTH_SECRET! });
  if (!payload?.sub) return unauthorizedResponse(c);

  const orgId = await fetchUserDefaultOrgId(payload.sub);
  if (!orgId) return forbiddenResponse(c, 'No org membership');

  c.set('user', { id: payload.sub, email: payload.email });
  c.set('orgId', orgId);
  await next();
});
```

### Custom JWT (own auth, no SaaS)

```ts
import * as jose from 'jose';

const SECRET = new TextEncoder().encode(process.env.JWT_SECRET!);

export const withAuth = createMiddleware<{ Variables: AuthVariables }>(async (c, next) => {
  const token = c.req.header('authorization')?.replace('Bearer ', '');
  if (!token) return unauthorizedResponse(c);

  try {
    const { payload } = await jose.jwtVerify(token, SECRET);
    const orgId = payload.org_id as string | undefined ?? await fetchUserDefaultOrgId(payload.sub as string);
    if (!orgId) return forbiddenResponse(c, 'No org membership');

    c.set('user', { id: payload.sub as string, email: payload.email as string });
    c.set('orgId', orgId);
    await next();
  } catch {
    return unauthorizedResponse(c);
  }
});
```

## Client-side implications

If you swap providers:

- **`lib/supabase/client.ts`** → replace with the equivalent client SDK
  for your provider. The shape consumed by `lib/contexts/AuthContext.tsx`
  is just `getSession()` + `signInWithOtp()` + `signOut()` +
  `onAuthStateChange()`.
- **`lib/api-client.ts apiFetch`** — already attaches a Bearer token from
  the Supabase session. Adapt to read the token from your provider.
- **`lib/electric/collections/factory.ts getAuthHeader()`** — same. The
  Electric shape stream needs a fresh Bearer token on every request from
  native (cross-origin), so the function is called per-request.
- **`lib/contexts/OrgContext.tsx`** — currently queries
  `org_members(org_id, orgs(name))` from Supabase. If your DB layout
  differs, point it at the right query.

## Multi-org

The boilerplate ships single-org-per-user. To extend:

1. Drop the `on_auth_user_created` trigger in the migration (so users
   no longer get an auto-org).
2. Build an org-creation flow (invite codes, "Create workspace" button).
3. Persist the user's selected org in localStorage.
4. Send `X-Org-Id` on every API call. The default `withAuth` already
   validates membership against this header and falls back to the first
   org if the header is missing.
5. On org switch, **recreate the Electric collections** so they stream
   from the new org's shape. The current TanStackDbProvider doesn't have
   a switcher — implement a cleanup-then-recreate pattern: dispose the
   current collections, update the orgId state, and let the `useMemo`
   that builds collections produce a fresh set keyed off the new orgId.

The Electric proxy (`examples/server-hono/server/routes/electric.ts`) is already org-aware:
it reads `c.var.orgId` and injects `where: org_id = '<resolved>'` for
every org-scoped table.
