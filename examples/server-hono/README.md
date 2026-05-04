# Reference backend (Hono / Node)

This is **one** implementation of the contracts in
[`docs/BACKEND_CONTRACTS.md`](../../docs/BACKEND_CONTRACTS.md). Vitronitor's
client is backend-agnostic — pick this, port it, or swap it out entirely.

## Why it lives in `examples/`

The boilerplate proper is client-only (web + iOS + Android + Electron +
sync + OTA publish). The server is *one* path; this folder makes that
explicit. AI assistants and humans porting to a different stack
(Bun / Workers / Express / FastAPI / Rails / Go / .NET) can read these
~875 lines of working code as a faithful spec — usually higher fidelity
than prose alone.

## What it implements

Eight HTTP endpoints behind a Bearer-JWT + org-resolution middleware:

| Method + path | Purpose |
|---|---|
| `GET /api/health` | Liveness + version (no auth) |
| `GET/POST/PATCH/DELETE /api/notes[/:id]` | Notes CRUD demo (org-scoped, soft-delete) |
| `GET /api/electric/shape` | Electric proxy with org-scoped WHERE injection |
| `POST /api/capacitor/bundle` | Capacitor (iOS Capgo) OTA manifest endpoint |
| `POST /api/electron/bundle` | Electron renderer OTA manifest endpoint |
| `GET /api/electron/shell/*` | electron-updater feed (yml + presigned binaries) |

Plus a `withAuth` middleware that resolves `c.var.user` and `c.var.orgId`
from a Supabase JWT. Replace this single file to swap auth providers —
see [`docs/AUTH.md`](../../docs/AUTH.md).

The Electric proxy in `server/routes/electric.ts` carries non-trivial
error handling (304/409 forwarding, header passthrough, cache stripping)
worth lifting to your port verbatim.

## Running it

The example is self-contained — its own `package.json`, deps, and scripts.

```bash
cd examples/server-hono
npm install --legacy-peer-deps
cp .env.example .env.local        # fill in Supabase + Electric + S3 creds
npm run dev                        # Hono on :3001 + Caddy on :3000
```

Open `https://localhost:3000`. Caddy fronts both this server and the
parent project's Vite dev server (run `npm run dev` from the repo root
in another terminal).

| Terminal | Working dir | Command | What it serves |
|---|---|---|---|
| 1 | repo root | `npm run dev` | Vite SPA on `:5173` |
| 2 | `examples/server-hono/` | `npm run dev` | Hono API on `:3001` + Caddy on `:3000` |

Caddy routes:
- `/api/*` → Hono
- everything else → Vite

If Caddy isn't installed, run `npm run dev:plain` here to skip it; you'll
hit Hono directly at `http://localhost:3001` (no HTTPS, Vite proxy in
`vite.config.ts` handles routing in that mode).

## Files

```
examples/server-hono/
├── server/
│   ├── index.ts                 entry: validateEnv() + serve()
│   ├── app.ts                   Hono app + route mounts + SPA fallback
│   ├── lib/
│   │   ├── env.ts               fail-fast env validator
│   │   └── response.ts          { ok, data | error } envelope helpers
│   ├── middleware/
│   │   ├── auth.ts              withAuth — JWT verify + org resolve
│   │   └── security-headers.ts  CSP / HSTS / etc.
│   └── routes/                  one file per endpoint group
├── lib/
│   ├── object-storage.ts        S3 client + presigned URL helpers
│   └── supabase-admin.ts        Supabase service-role client
├── Caddyfile                    HTTP/2 dev proxy (Vite + Hono)
├── package.json
├── tsconfig.json
├── .env.example
└── README.md
```

## Shared with the parent project

Two files are imported back from the repo root via relative paths
(`../../../../lib/...`):

- `lib/electric/tables.ts` — table list + scope helpers shared with the
  client. Keep both sides in sync when you add a table.
- `lib/version.ts` — `APP_VERSION` from `package.json`, surfaced by `/api/health`.

If you copy this folder out as your standalone backend, also copy those
two files (or define equivalents).

## License

Same as the parent project — [MIT](../../LICENSE).
