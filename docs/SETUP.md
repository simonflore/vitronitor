# Setup

End-to-end first-time setup for Vitronitor.

The repo has two halves you bring up independently:

- **Root** — the client (web SPA + iOS + Android + Electron).
- **`examples/server-hono/`** — the optional reference backend.

You need both running together to exercise the full sync + auth flow.
For client-only work (UI tweaks, Electron shell, Capacitor scaffolding)
the root alone is enough.

## Prerequisites

- **Node 22+** — `.nvmrc` files in the root and example pin the version. `nvm use` / `fnm use`.
- A **Supabase project** — see [SUPABASE.md](./SUPABASE.md). Free tier is fine. Used for auth, Postgres, and Realtime broadcast.
- An **S3-compatible bucket** for OTA bundles — see [OBJECT_STORE_SETUP.md](./OBJECT_STORE_SETUP.md). AWS S3, Cloudflare R2, MinIO, and Garage all work.
- **Caddy** (optional) if you want HTTPS in dev for the reference backend:
  - macOS: `brew install caddy && caddy trust`
  - Debian/Ubuntu: <https://caddyserver.com/docs/install>
  - `caddy trust` writes a self-signed root CA so `https://localhost:3000` doesn't warn.

Caddy isn't required — Vite's `/api` proxy + the Hono dev server work fine
over plain HTTP. Caddy is here so dev exercises the same HTTP/2 multiplex
semantics you'll get in production (long-lived Supabase Realtime WebSocket
+ concurrent `/api/sync` requests behind one origin).

## Install + run (client)

```bash
cd vitronitor
bash scripts/setup.sh             # interactive: app id / scheme / API URL
cp .env.example .env.local
npm install --legacy-peer-deps
bash scripts/setup-signing-key.sh # one-time: OTA signing key
npm run dev                       # Vite SPA on :5173
```

Open `http://localhost:5173`. The home page renders, but API calls will
fail until you bring up a backend.

## Install + run (reference backend)

In a second terminal:

```bash
cd vitronitor/examples/server-hono
cp .env.example .env.local
npm install --legacy-peer-deps
npm run dev                       # Hono :3001 + Caddy :3000
```

Open `https://localhost:3000`. Caddy fronts both processes —
`/api/*` → Hono, everything else → the Vite dev server at the root.

## Verify

You should see:

- Home page loads at `https://localhost:3000` and shows the JSON from `GET /api/health`.
- HMR works — edit `app/home/page.tsx`, the page updates without reload.
- `curl https://localhost:3000/api/health` returns `{"ok":true,"data":{...}}`.
- `npm run lint && npm run typecheck` (root) both exit 0.
- `npm run build` (root) produces `dist/` with no errors.
- `npm run typecheck` (in `examples/server-hono/`) exits 0.

The root build wrapper `scripts/vite-build-prod.sh` first scrubs all
`VITE_*` shell env vars to prevent dev URLs leaking into the prod
bundle (a real footgun — see the comment at the top of the script).

## Troubleshooting

**Caddy refuses to bind / asks for sudo** — `localhost:3000` is
unprivileged; Caddy doesn't need root. The error means the wrong config
path; verify `Caddyfile` exists at `examples/server-hono/Caddyfile`.

**`caddy: command not found`** — install Caddy or skip it:
`npm run dev:plain` inside `examples/server-hono/` runs only Hono on
`:3001` and you hit it via the Vite proxy at `http://localhost:5173`.

**Browser warns about cert** — re-run `caddy trust`. On Linux, may need
`caddy trust --force` plus a browser restart.

**Ports 3000 / 3001 / 5173 already in use** — `lsof -i :3001` to find
the offender. Or change the port: Vite in `vite.config.ts`, Hono via
`PORT` env, Caddy in `Caddyfile`.

**Frontend renders but `/api/*` calls fail** — the reference backend
isn't running. Start it (see above) or bring your own backend on
`:3001`. The Vite proxy routes `/api/*` there.
