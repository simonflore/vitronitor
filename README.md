# Vitronitor

**One React codebase → web + iOS + Android + Electron, offline-first via a TanStack DB mutation outbox.** Reads flow through [`@tanstack/query-db-collection`](https://tanstack.com/db) over plain HTTP at `/api/sync/:table`; writes flow through [`@tanstack/offline-transactions`](https://tanstack.com/db) into a durable SQLite-backed outbox that drains on reconnect and dead-letters on permanent failure; [Supabase Realtime](https://supabase.com/docs/guides/realtime) broadcasts trigger `invalidateQueries` for cross-device propagation. Plus self-hosted OTA on all four targets and a Hono reference backend, swappable for any HTTP framework. MIT.

## What makes this different

Most cross-platform starters give you exactly one of these. Vitronitor wires all three together as a working app you can clone and run:

1. **Offline-first via `@tanstack/offline-transactions`** — every write persists to a durable SQLite outbox before it leaves the client. OPFS-backed wa-sqlite on web and Electron renderer (over a registered `app://` scheme so OPFS gets a real origin), native SQLite via [`@capacitor-community/sqlite`](https://github.com/capacitor-community/sqlite) on iOS and Android. The outbox drains on reconnect with idempotency keys; permanent server errors (404/410/422) throw `NonRetriableError` so the entry dead-letters instead of looping forever. Reads are symmetric — [TanStack DB](https://tanstack.com/db) collections fetch `GET /api/sync/:table` via `@tanstack/query-db-collection`, and [Supabase Realtime](https://supabase.com/docs/guides/realtime) broadcasts (`{ table, op, id }` on channel `org:${orgId}`) trigger `invalidateQueries` for cross-device propagation. All in [`lib/sync/`](./lib/sync) and [`lib/realtime/broadcast-listener.tsx`](./lib/realtime/broadcast-listener.tsx).
2. **Self-hosted OTA across all four targets** — iOS via self-hosted [Capgo](https://capgo.app), Electron via a custom shell auto-updater + a renderer-only state machine, web via Service Worker. One signing key, one S3-compatible bucket, one `publish → sign → serve → verify` loop you fully own. No Capgo Cloud, no EAS Update, no GitHub Releases dependency. Ship JS updates as fast as you ship to the web.
3. **Real native shell on every platform** — [Capacitor](https://capacitorjs.com) for iOS/Android with a custom-plugin pattern, **raw [Electron](https://www.electronjs.org) for desktop** (not the Capacitor-Community-Electron wrapper, which loses tray, multi-window, IPC depth, safeStorage). Two purpose-built native shells sharing one Vite/React renderer. System tray, deep-link handler, single-instance lock, IPC-backed safeStorage auth — Electron as Electron, not as a Capacitor flavour.

The reference stack is **Vite + React 19 + Tailwind v4 + Hono + Supabase + S3-compatible storage**. The backend framework, auth provider, and object store are all swappable — see [`docs/BACKEND_CONTRACTS.md`](./docs/BACKEND_CONTRACTS.md) for the HTTP+JSON contracts a backend has to satisfy. Compatible with **Bun, Cloudflare Workers, Deno, Express, Fastify, Elysia, Next.js API routes — or PHP, Python, Ruby, Go, Rust, .NET**.

## Quick start

Vitronitor is **client-only at the root**. The server is a swappable
concern — a reference Hono backend lives at [`examples/server-hono/`](./examples/server-hono),
and any backend that satisfies [`docs/BACKEND_CONTRACTS.md`](./docs/BACKEND_CONTRACTS.md)
will work.

Prerequisites: Node 22+, a Supabase project (used for auth, Postgres, and
Realtime broadcast), an S3-compatible bucket for OTA bundles. Plus Caddy
(`brew install caddy && caddy trust`) if you run the reference backend
behind HTTPS in dev — optional.

```bash
git clone <your-fork>
cd vitronitor
bash scripts/setup.sh             # interactive: app id / scheme / API URL
cp .env.example .env.local        # fill in Supabase + S3 creds
npm install --legacy-peer-deps
bash scripts/setup-signing-key.sh # one-time: OTA signing key
                                  # paste printed PEM into:
                                  #   capacitor.config.ts CapacitorUpdater.publicKey
                                  #   electron/main/renderer-ota.ts PUBLIC_KEY_PEM
npm run dev                       # Vite SPA on :5173
```

To run the **reference backend** in another terminal:

```bash
cd examples/server-hono
npm install --legacy-peer-deps
cp .env.example .env.local        # fill in Supabase + S3 creds
npm run dev                       # Hono on :3001 + Caddy on :3000
```

Open `https://localhost:3000`. Caddy fronts both processes — `/api/*` →
Hono, everything else → the Vite dev server at the root.

To **bring your own backend**: implement the contracts in
[`docs/BACKEND_CONTRACTS.md`](./docs/BACKEND_CONTRACTS.md) on whatever
stack you like (Bun, Cloudflare Workers, Express, FastAPI, Rails, Go,
…). The Vite proxy at `/api` → `localhost:3001` works for any backend
listening on that port; tweak `vite.config.ts` if yours runs elsewhere.

## The notes example

The repo demonstrates the full offline-first sync pattern with one table:
`notes(id, org_id, user_id, title, body, created_at, updated_at, deleted_at)`.

| File | Purpose |
|---|---|
| `supabase/migrations/00000000000000_init_notes.sql` | Schema + RLS + the org-per-user trigger |
| `lib/db/types/notes.ts` | DbNote (snake_case) + Note (camelCase) types |
| `lib/sync/collections/generated/note.generated.ts` | Zod schema (codegen output) |
| `lib/sync/collections/notes.ts` | Converters + `createOrgScopedCollection` call |
| `lib/sync/offline-executor.ts` | `syncNotes` mutationFn (POST/PATCH/DELETE with `NonRetriableError`) |
| `examples/server-hono/server/routes/notes.ts` | CRUD behind withAuth, soft-delete, broadcasts after every mutation |
| `examples/server-hono/server/routes/sync.ts` | `GET /api/sync/:table` bulk read scoped by `org_id` |
| `lib/hooks/useNotes.ts` | Public API: useNotes / useNote / createNote / updateNote / deleteNote |
| `app/notes/page.tsx` | List view with create + delete |
| `app/notes/[id]/page.tsx` | Detail view with debounced autosave |

## Adding a new collection (6-step recipe)

1. **Migration** — `supabase/migrations/<ts>_add_<table>.sql` with `org_id`
   FK + indexes + RLS policies.
2. **Type** — `lib/db/types/<name>.ts` with `Db<Name>` (snake_case) and
   `<Name>` (camelCase) interfaces.
3. **Codegen** — add the table to `TABLES[]` in
   `scripts/generate-schemas.ts` and run
   `npx tsx scripts/generate-schemas.ts`.
4. **Collection** — `lib/sync/collections/<name>.ts`: converters + a
   `createOrgScopedCollection<Db<Name>Row>({ table, schema, onInsert, onUpdate, onDelete })`
   call. Add the table to the allowlist in `lib/sync/config.ts`.
5. **Executor + provider** — add a `mutationFn` factory + `MUTATION_FN_NAMES`
   entry in `lib/sync/offline-executor.ts`, then register the collection
   in `lib/sync/TanStackDbProvider.tsx`.
6. **Hook + UI + server route** — `lib/hooks/use<Name>.ts` mirrors
   `useNotes.ts`; pages under `app/<name>/`; CRUD route under
   `examples/server-hono/server/routes/<name>.ts` (don't forget the
   `broadcastChange` calls after every mutation).

`docs/ARCHITECTURE.md` has the full walkthrough.

## Project structure

```
vitronitor/                    ← client-only (web + iOS + Android + Electron)
├── src/                       Vite SPA entry (main.tsx, App.tsx, router.tsx)
├── app/                       Page components, lazy-loaded by router
│   ├── home/page.tsx          live notes preview + sign-in
│   ├── notes/                 list + detail with autosave
│   ├── login|signup|auth/     Supabase magic-link flow
│   ├── settings/              user info + OTA debug link
│   └── dev/update-debug/      manual OTA control surface
├── lib/
│   ├── api-client.ts          apiFetch wrapper (Bearer auth, platform-aware base URL)
│   ├── platform.ts            isWeb / isCapacitor / isElectron sentinels
│   ├── version.ts             APP_VERSION (synced from package.json)
│   ├── query-client.ts        shared TanStack Query client singleton
│   ├── supabase/              browser client + native-storage adapter
│   ├── contexts/              Auth, Org, Network providers
│   ├── db/types/              Db* / app types (notes is the example)
│   ├── sync/                  the offline-first sync layer
│   │   ├── TanStackDbProvider Per-user SQLite open, collection lifecycle,
│   │   │                      executor wiring, broadcast listener mount
│   │   ├── collections/       factory + notes (canonical pattern)
│   │   ├── offline-executor   @tanstack/offline-transactions outbox + mutationFns
│   │   └── config.ts          allowlist + scope helpers shared with the server
│   ├── realtime/              Supabase Realtime broadcast listener
│   ├── hooks/                 useNotes, useCollection,
│   │                          useCapacitorUpdater, useElectronUpdater,
│   │                          useServiceWorker
│   └── electron/              types.d.ts (window.electronAPI shape)
├── components/                ui/* shadcn primitives, layout/OfflineBanner,
│                              admin/UpdateDebugPanel
├── electron/                  Electron main process + preload + tray + IPC
│   ├── main/index.ts          BrowserWindow, deep-link, single-instance lock,
│   │                          `app://` protocol handler (gives OPFS a real origin)
│   ├── main/preload.ts        contextBridge surface
│   ├── main/updater.ts        electron-updater wrapper
│   ├── main/renderer-ota.ts   custom renderer OTA state machine
│   └── main/ipc/storage.ts    safeStorage-backed KV (Supabase auth backing)
├── plugins/                   (empty — use `npm init @capacitor/plugin@latest`)
├── ios/, android/             generated by `npx cap add ios|android` (not committed)
├── fastlane/                  Appfile + Matchfile + Fastfile (iOS release)
├── supabase/migrations/       initial notes schema + RLS + triggers
├── scripts/                   setup, sync-version, codegen, publish scripts
├── public/                    sw.js (service worker), manifest.json
├── .github/workflows/         capacitor-bundle, electron-bundle
├── capacitor.config.ts        Capacitor config + CapacitorUpdater
├── electron-builder.config.cjs (CJS — needs env interp for publish.url)
├── docs/                      ARCHITECTURE, SETUP, BACKEND_CONTRACTS,
│                              CAPACITOR, FASTLANE, ELECTRON, ELECTRON_OTA,
│                              SIGNING_KEY, SUPABASE, OBJECT_STORE_SETUP,
│                              PWA, AUTH
└── examples/server-hono/      reference Hono backend (optional;
                               implements docs/BACKEND_CONTRACTS.md)
```

## Building & releasing

| Target | Command | Docs |
|---|---|---|
| Web (PWA) | `npm run build` → serve `dist/` from any static host (or the example backend) | [PWA.md](./docs/PWA.md) |
| iOS (TestFlight) | `bundle exec fastlane ios beta` | [FASTLANE.md](./docs/FASTLANE.md) |
| iOS (App Store) | `bundle exec fastlane ios release` | [FASTLANE.md](./docs/FASTLANE.md) |
| iOS (OTA only) | `npm run cap:publish-bundle` | [SIGNING_KEY.md](./docs/SIGNING_KEY.md) |
| Android | `npm run cap:sync && cap:open:android` | [CAPACITOR.md](./docs/CAPACITOR.md) |
| Electron (binary) | `npm run electron:build:mac:dev` | [ELECTRON.md](./docs/ELECTRON.md) |
| Electron (shell publish) | `npm run electron:publish-shell` | [ELECTRON_OTA.md](./docs/ELECTRON_OTA.md) |
| Electron (renderer OTA) | `npm run electron:publish-bundle` | [ELECTRON_OTA.md](./docs/ELECTRON_OTA.md) |

## Backend portability

Hono is the reference, but it's not load-bearing. The contracts the
client cares about are HTTP + JSON, fully language-agnostic. To swap to
Bun / Workers / Express / FastAPI / Laravel / Rails / Go / Rust / .NET,
implement the endpoints in [`docs/BACKEND_CONTRACTS.md`](./docs/BACKEND_CONTRACTS.md):

- `withAuth` middleware that resolves `user` + `orgId` from a Bearer JWT
- `{ ok, data } | { ok: false, error, code? }` response envelope
- `GET /api/sync/:table` — bulk-read endpoint, filter by `org_id`
- `POST /api/notes` / `PATCH /api/notes/:id` / `DELETE /api/notes/:id` —
  CRUD with `broadcastChange` calls after every mutation
- `POST /api/capacitor/bundle` (iOS Capgo manifest contract)
- `POST /api/electron/bundle` (Electron renderer OTA)
- `GET /api/electron/shell/*` (electron-updater generic provider)

## Swapping out Supabase

The auth seam is the `withAuth` middleware in `examples/server-hono/server/middleware/auth.ts`.
It resolves `c.var.user` + `c.var.orgId` from a Supabase Bearer JWT today.
To swap to Clerk / Auth.js / a hand-rolled JWT setup, replace just that
middleware. See [`docs/AUTH.md`](./docs/AUTH.md).

Cross-device broadcasts use Supabase Realtime today (`server/lib/broadcast.ts`
posts to `/realtime/v1/api/broadcast`). Swap to any pub/sub that can
deliver a `{ table, op, id }` payload to subscribed clients — the
client-side listener at `lib/realtime/broadcast-listener.tsx` is the
matching seam.

The database doesn't have to be Supabase Postgres either. Self-hosted
Postgres works the same way; the migrations are plain SQL.

## Documentation index

- **[SETUP.md](./docs/SETUP.md)** — end-to-end first-time setup
- **[ARCHITECTURE.md](./docs/ARCHITECTURE.md)** — Mermaid component + sync-flow + OTA-state-machine diagrams
- **[BACKEND_CONTRACTS.md](./docs/BACKEND_CONTRACTS.md)** — HTTP+JSON spec for backend ports
- **[SUPABASE.md](./docs/SUPABASE.md)** — Supabase project + migration walkthrough
- **[AUTH.md](./docs/AUTH.md)** — auth middleware contract + swap recipes
- **[OBJECT_STORE_SETUP.md](./docs/OBJECT_STORE_SETUP.md)** — bucket layout + Garage quirks
- **[CAPACITOR.md](./docs/CAPACITOR.md)** — iOS + Android scaffolding + custom plugin pattern
- **[FASTLANE.md](./docs/FASTLANE.md)** — iOS release pipeline
- **[ELECTRON.md](./docs/ELECTRON.md)** — Electron shell + IPC walkthrough
- **[ELECTRON_OTA.md](./docs/ELECTRON_OTA.md)** — shell auto-update + renderer OTA pipelines
- **[SIGNING_KEY.md](./docs/SIGNING_KEY.md)** — OTA signing key generation + rotation
- **[PWA.md](./docs/PWA.md)** — Service Worker + offline UX

## Contributing

PRs welcome. Read [CONTRIBUTING.md](./CONTRIBUTING.md) first — it covers
what's in scope, the dev setup, the local checks CI enforces, and the
naming conventions a boilerplate has to keep tidy.

By participating, you agree to the [Code of Conduct](./CODE_OF_CONDUCT.md).

For **security vulnerabilities**, follow [SECURITY.md](./SECURITY.md) —
do not open a public issue.

## Acknowledgments

Vitronitor stands on the shoulders of the OSS projects it bundles —
[Vite](https://vitejs.dev), [React](https://react.dev),
[Tailwind CSS](https://tailwindcss.com), [Hono](https://hono.dev),
[Supabase](https://supabase.com),
[TanStack DB + Query + offline-transactions](https://tanstack.com),
[Capacitor](https://capacitorjs.com),
[Capgo](https://capgo.app), [Electron](https://www.electronjs.org), and
[electron-updater](https://www.electron.build/auto-update). Thanks to
everyone who maintains them.

## License

MIT — see [LICENSE](./LICENSE). By contributing you agree your changes
ship under the same license.
