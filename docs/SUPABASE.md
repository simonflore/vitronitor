# Supabase setup (M2)

Vitronitor uses Supabase as the reference auth + Postgres provider. The contracts
in `docs/BACKEND_CONTRACTS.md` (added in M3) explain what to implement if you
want to swap it for Auth.js / Clerk / a hand-rolled JWT setup.

## 1. Create a project

1. Sign up at https://supabase.com/ and create a new project.
2. Note the **project URL** (`https://<ref>.supabase.co`) and the **anon key**
   from Project Settings → API.
3. Copy the **service-role key** from the same page — server-only, never ship
   to the client.

## 2. Wire up env vars

```bash
cp .env.example .env.local
# fill in:
#   VITE_SUPABASE_URL=https://<ref>.supabase.co
#   VITE_SUPABASE_ANON_KEY=<anon-key>
#   SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
```

`examples/server-hono/server/lib/env.ts` enforces these at server boot — missing any of them aborts
startup with a clear error.

## 3. Apply the initial migration

```bash
npx supabase login
npx supabase link --project-ref <your-project-ref>
npx supabase db push
```

This runs `supabase/migrations/00000000000000_init_notes.sql`, which creates
`orgs`, `org_members`, `notes`, RLS policies, the `set_updated_at` trigger,
and the `on_auth_user_created` trigger that auto-creates one workspace per
new user.

To verify, open Supabase Studio → SQL editor:

```sql
select id, name, created_at from public.orgs;
select * from public.notes;
```

Both should be empty until your first user signs up.

## 4. Sign up

```bash
npm run dev
# https://localhost:3000
```

1. Click **Sign in** → enter your email → **Send magic link**.
2. Open the link in your inbox. The browser lands on `/#/auth/callback` and
   then `/home`.
3. Confirm in Supabase Studio that:
   - `auth.users` has your row
   - `public.orgs` now has one workspace
   - `public.org_members` has one row joining you to that workspace

## 5. Verify the API

```bash
# get your access token from the browser console:
#   await (await fetch('/api/health')).text()  ← should still be { ok, data }
JWT=<copy from supabase.auth.getSession() in DevTools>

curl -X POST https://localhost:3000/api/notes \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -d '{"title": "First note"}'

# returns { "ok": true, "data": { "id": "...", "org_id": "...", ... } }

curl https://localhost:3000/api/notes -H "Authorization: Bearer $JWT"
# returns { "ok": true, "data": [ ... ] }
```

The home page lists the notes via the same endpoint and lets you create new
ones with **+ New**.

## 6. RLS sanity check

The service-role key bypasses RLS, so cross-org leakage shows up in the API
*only if your code forgets to filter by `org_id`*. To verify the policies
themselves, query as the user (anon key + Bearer token) and try to read
another org's notes:

```sql
-- in Supabase Studio, set role:
set local role authenticated;
set local request.jwt.claims = '{"sub": "<your-user-id>"}'::jsonb;

select * from public.notes;             -- only your org's notes
select * from public.notes where org_id = '<other-org>';  -- empty
```

## Multi-org

The single-org-per-user trigger is documented at the top of
`supabase/migrations/00000000000000_init_notes.sql`. To go multi-org:

1. Drop `on_auth_user_created` (or leave it as the default for new users).
2. Build an org-creation flow (invite codes, "create another workspace" button).
3. Persist the user's selected org id (localStorage).
4. Send `X-Org-Id` on every API call (the auth middleware already validates).
5. Recreate Electric collections on org switch (M3 — see TanStackDbProvider).
