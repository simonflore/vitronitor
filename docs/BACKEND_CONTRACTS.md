# Backend contracts

The Vitronitor client cares about HTTP + JSON only. Implement these endpoints
in any framework / language and the rest of the stack works.

The reference implementation is **Hono on Node** (in `server/`). To swap
to Bun, Cloudflare Workers, Deno, Express, Fastify, Elysia, Next.js API
routes — or PHP/Python/Ruby/Go/Rust/.NET — keep these contracts and the
client doesn't notice.

## 1. Auth resolution (middleware contract)

Every protected endpoint runs through a middleware that:

- Extracts either `Authorization: Bearer <jwt>` or
  `Authorization: Bearer gig_<api-key>` (optional) or `sb-*-auth-token`
  cookie (optional).
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
| 409 | conflict (also: Electric "must-refetch") |
| 429 | rate limit |
| 500 | server error |
| 503 | upstream / DB unavailable |

The client (`lib/api-client.ts → apiFetch`) unwraps `data` automatically
and throws an `ApiFetchError` on `ok: false`.

Reference: `examples/server-hono/server/lib/response.ts`.

## 3. `GET /api/electric/shape`

The Electric SDK long-polls this endpoint. The proxy must:

| Step | Detail |
|---|---|
| Auth | Run the auth middleware. Reject 401 if no valid JWT. |
| Validate `table` query param | Required. Reject 400 if missing. |
| Build upstream URL | Append `source_id` + `source_secret` for Electric Cloud, or whatever your self-hosted Electric needs. |
| Inject scope filter | Org-scoped tables → append `where: org_id = '<resolved>'`. User-scoped tables → append `where: user_id = '<resolved>'`. **Drop any client-supplied `where`.** |
| Forward other client params | Anything not in `{table, where, _org}` — passes through `cache-buster`, `log`, `replica`, etc. |
| Fetch upstream | `GET <electric>/v1/shape?...` with `cache: 'no-store'`. Do NOT forward `If-None-Match` (you don't want Electric returning 304 with a stale shape handle). |
| Forward Electric headers | `electric-offset`, `electric-handle`, `electric-schema`, `electric-cursor`, `electric-up-to-date`. |
| Strip caching headers | Set `Cache-Control: no-store`, `CDN-Cache-Control: no-store`. **Do NOT** forward `cache-control` or `etag` from upstream — both cause cross-org leakage / stale handles. |
| Status pass-through | 304 → forward as-is. 409 → forward (client recreates the collection). Other 4xx/5xx → 500 to client. |

Reference: `examples/server-hono/server/routes/electric.ts`.

## 4. Notes CRUD

A simple example domain. For your real schema, replicate the pattern:
behind `withAuth`, scoped by `c.var.orgId`, soft-delete on DELETE so
Electric publication can stream the change.

| Method | Path | Body | Response |
|---|---|---|---|
| POST | `/api/notes` | `{ id?, title?, body? }` | `{ ok: true, data: <full row> }` (201) |
| PATCH | `/api/notes/:id` | `{ title?, body? }` | `{ ok: true, data: <full row> }` |
| DELETE | `/api/notes/:id` | – | `{ ok: true, data: { id } }` |
| GET | `/api/notes` | – | `{ ok: true, data: [...] }` |

Reference: `examples/server-hono/server/routes/notes.ts`.

## 5. `POST /api/capacitor/bundle` (iOS Capgo)

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

## 6. `POST /api/electron/bundle`

Same shape as `/api/capacitor/bundle`, plus:

- Request adds `native_version` (the installed Electron shell version).
- Response adds `min_native_version`.

The server withholds the bundle (returns `{}`) if `native_version` <
`min_native_version`. Lets you ship a renderer that uses new IPC methods
without breaking installed users on the old shell.

Reference: `examples/server-hono/server/routes/electron-bundle.ts`.

## 7. `GET /api/electron/shell/*`

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

Reference: `examples/server-hono/examples/server-hono/server/routes/electron-shell.ts`.

## 8. Object store client

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

Reference: `lib/object-storage.ts`.

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
- [ ] `GET /api/electric/shape` proxy with all the header / where rules
- [ ] `GET/POST/PATCH/DELETE /api/notes(/:id)` for the example domain
- [ ] `POST /api/capacitor/bundle` (iOS Capgo)
- [ ] `POST /api/electron/bundle`
- [ ] `GET /api/electron/shell/*` (electron-updater)
- [ ] Object store client (presigned GET + PUT, plus a way to read the manifest)
- [ ] Env validation that fails fast at boot if Supabase / Electric / S3 vars are missing
- [ ] Static SPA serving in production (or front with nginx / Caddy in front of an API-only backend)

That's it. The client doesn't care which language the server is written in.
