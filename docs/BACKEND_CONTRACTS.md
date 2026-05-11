# Backend contracts

The Vitronitor client cares about HTTP + JSON only. Implement these endpoints
in any framework / language and the rest of the stack works.

The reference implementation is **Hono on Node** (in `examples/server-hono/`).
To swap to Bun, Cloudflare Workers, Deno, Express, Fastify, Elysia, Next.js
API routes — or PHP/Python/Ruby/Go/Rust/.NET — keep these contracts and the
client doesn't notice.

## 1. Auth resolution (middleware contract)

Every protected endpoint runs through a middleware that:

- Extracts `Authorization: Bearer <jwt>` (the only client today; cookie /
  API-key are documented extension points).
- Validates the JWT against your auth provider (Supabase by default).
- Resolves `orgId` from the validated user — either by reading
  `X-Org-Id` header (for multi-org apps) or by picking the user's first
  org membership (single-org default).
- Sets two values on the request context that downstream handlers read:
  `user` (any provider-specific shape; the boilerplate uses Supabase's
  `User`) and `orgId` (UUID string).
- On failure, returns the appropriate error envelope:
  - missing/invalid token → 401 `{ ok: false, error: 'Unauthorized', code: 'AUTH_UNAUTHORIZED' }`
  - non-member of requested org → 403 `{ ok: false, error: '...', code: 'FORBIDDEN_NOT_MEMBER' }`
  - DB error during membership check → 503

Reference: `examples/server-hono/server/middleware/auth.ts`.

## 2. Response envelope

All responses share one of two shapes:

```ts
type Success<T> = { ok: true; data: T };
type Error      = { ok: false; error: string; code?: string };
```

Status codes:

| Status | Use |
|---|---|
| 200 | success with body |
| 201 | created |
| 204 | success no body |
| 400 | malformed input |
| 401 | unauthenticated |
| 403 | forbidden |
| 404 | resource not found |
| 410 | gone (dead-lettered by the offline executor) |
| 422 | unprocessable entity (dead-lettered by the offline executor) |
| 429 | rate limit |
| 500 | server error |
| 503 | upstream / DB unavailable |

The client (`lib/api-client.ts → apiFetch`) unwraps `data` automatically
and throws an `ApiFetchError` on `ok: false`. Permanent errors (404 /
410 / 422 — also 400 with `/no longer exists|not found/i`) cause the
sync layer's `OfflineExecutor` to throw `NonRetriableError` so the
captured mutation is dead-lettered instead of retried forever.

Reference: `examples/server-hono/server/lib/response.ts`,
`lib/sync/offline-executor.ts → isPermanentApiError`.

## 3. `GET /api/sync/:table`

The bulk-read endpoint that `@tanstack/query-db-collection` calls on
collection mount and on broadcast-triggered `invalidateQueries`.

| Step | Detail |
|---|---|
| Auth | Run the auth middleware. Reject 401 if no valid JWT. |
| Validate `table` param | Must be on the allowlist (see `lib/sync/config.ts → isOrgScopedTable`). Reject 400 if unknown — defence in depth on top of RLS. |
| Filter | `SELECT * FROM <table> WHERE org_id = c.var.orgId`. Add scope variants (per-user, per-team) by extending `lib/sync/config.ts` and branching here. |
| Response | `{ ok: true, data: [...rows] }` with snake_case columns matching the Zod schemas in `lib/sync/collections/generated/`. |

Reference: `examples/server-hono/server/routes/sync.ts`.

## 4. CRUD endpoints (per collection)

Per-collection HTTP routes paired with the offline executor's
`mutationFn`. For the `notes` collection:

| Method | Path | Body | Response |
|---|---|---|---|
| POST | `/api/notes` | `{ id?, title?, body? }` | `{ ok: true, data: <full row> }` (201) |
| PATCH | `/api/notes/:id` | `{ title?, body? }` | `{ ok: true, data: <full row> }` |
| DELETE | `/api/notes/:id` | – | `{ ok: true, data: { id } }` |
| GET | `/api/notes` | – | `{ ok: true, data: [...] }` (optional — `/api/sync/notes` is the canonical bulk-read endpoint) |

All routes:
- Run behind `withAuth`, scoped by `c.var.orgId`.
- Soft-delete on DELETE (set `deleted_at`) so subscribers see a row-update
  event rather than a phantom disappearance.
- **Call `broadcastChange({ orgId, table: 'notes', op, id })` after every
  successful mutation** so the client-side broadcast listener fires
  `invalidateQueries` on subscribed devices.

Reference: `examples/server-hono/server/routes/notes.ts`,
`examples/server-hono/server/lib/broadcast.ts`.

## 5. Realtime broadcast contract

After every server-side mutation, emit:

```
channel: org:${orgId}
event:   change
payload: { table: string, op: 'insert' | 'update' | 'delete', id: string }
```

The reference implementation uses Supabase Realtime's HTTP broadcast
endpoint (`POST <supabase>/realtime/v1/api/broadcast` with the
service-role key). Any pub/sub that can route the same payload to
subscribed clients works — replace `server/lib/broadcast.ts` and the
matching `lib/realtime/broadcast-listener.tsx`. Best-effort: clients
already refetch on focus + at `staleTime` boundaries, so a dropped
broadcast just means slightly delayed propagation.

## 6. `POST /api/capacitor/bundle` (iOS Capgo)

Public, no auth. Body:

```ts
{
  version_name?: string;     // current bundle version on device, or "builtin"
  version_build?: string;    // Xcode MARKETING_VERSION (fallback when "builtin")
  platform?: string;
  plugin_version?: string;
  // ... pass-through fields from Capgo plugin
}
```

Response if up-to-date OR no manifest available: `{}` (200).
Response if newer bundle exists:

```ts
{
  version: string;
  url: string;            // presigned GET URL, ~1h TTL
  checksum: string;       // RSA-signed hex checksum
  session_key: string;    // RSA-encrypted "iv:aesKey" wire format
}
```

Note the **snake_case `session_key`** — camelCase silently fails decryption
in the Capgo plugin.

Reference: `examples/server-hono/server/routes/capacitor-bundle.ts`.

## 7. `POST /api/electron/bundle`

Same shape as `/api/capacitor/bundle`, plus:

- Request adds `native_version` (the installed Electron shell version).
- Response adds `min_native_version`.

The server withholds the bundle (returns `{}`) if `native_version` <
`min_native_version`. Lets you ship a renderer that uses new IPC methods
without breaking installed users on the old shell.

Reference: `examples/server-hono/server/routes/electron-bundle.ts`.

## 8. `GET /api/electron/shell/*`

Generic-HTTP feed for `electron-updater`. Hits both:

- `latest-mac.yml` / `latest.yml` / `latest-linux.yml` — the manifest
- `<ProductName>-<version>-arm64.dmg`, `.zip`, `.exe`, `.AppImage`,
  `.blockmap` — the binaries

Implementation:

| Path ends in | Behavior |
|---|---|
| `.yml` / `.json` | Inline body. **Cache-Control: no-store, no-cache, must-revalidate** (Chromium aggressively caches these otherwise). |
| `.dmg` / `.zip` / `.exe` / `.AppImage` / `.blockmap` | 302 redirect to a presigned S3 URL (1h TTL). |
| Anything else | 404. |
| Path traversal (`..`, `//`) | 400. |

Reference: `examples/server-hono/server/routes/electron-shell.ts`.

## 9. Object store client

Used by all three OTA endpoints. The reference implementation supports
AWS S3 / Cloudflare R2 / MinIO / Garage.

Required operations:

- `createPresignedGetUrl(bucket, key, expiresIn)` → string
- `createPresignedPutUrl(bucket, key, contentType?, expiresIn)` → string
- `getObjectContent(bucket, key)` → bytes (used to read manifests)

Garage-specific quirk: AWS SDK v3.600+ adds CRC32 checksums by default;
Garage rejects them. Set `requestChecksumCalculation: 'WHEN_REQUIRED'` +
`responseChecksumValidation: 'WHEN_REQUIRED'` on the SDK client. Safe
on AWS / R2 / MinIO too.

Reference: `examples/server-hono/lib/object-storage.ts`.

## What's NOT contractual

The boilerplate ships these but they're nice-to-haves, not required:

- OpenAPI generation
- Sentry middleware
- Rate limiting per API key
- API key auth (in addition to Bearer + cookies)
- CORS
- Security headers middleware

Implement as you need them.

## Porting checklist

When swapping the backend:

- [ ] `withAuth` middleware that sets `user` + `orgId` on the request context
- [ ] Response envelope helpers (`success`, `error`, `notFound`, etc.)
- [ ] `GET /api/sync/:table` bulk-read endpoint scoped by `org_id`
- [ ] `GET/POST/PATCH/DELETE /api/notes(/:id)` for the example domain,
      with `broadcastChange` calls after every mutation
- [ ] A `broadcastChange` helper that emits `{ table, op, id }` on
      `org:${orgId}` (Supabase Realtime in the reference; any pub/sub works)
- [ ] `POST /api/capacitor/bundle` (iOS Capgo)
- [ ] `POST /api/electron/bundle`
- [ ] `GET /api/electron/shell/*` (electron-updater)
- [ ] Object store client (presigned GET + PUT, plus a way to read the manifest)
- [ ] Env validation that fails fast at boot if Supabase / S3 vars are missing
- [ ] Static SPA serving in production (or front with nginx / Caddy in front of an API-only backend)

That's it. The client doesn't care which language the server is written in.
