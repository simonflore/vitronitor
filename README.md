# Vitronitor

**Cross-platform offline-first React boilerplate** — web (PWA) + iOS + Android + Electron, with ElectricSQL + TanStack DB sync, custom self-hosted OTA pipelines, and a Hono reference backend (swappable for any HTTP framework).

## What makes this different

Most cross-platform starters give you one of these. Vitronitor gives you all three:

1. **Native-feel** — Capacitor for iOS/Android with a custom-plugin pattern, Electron with system tray, deep-link handler, and IPC-backed safeStorage auth. Not a thin web wrapper.
2. **Offline-first by default** — ElectricSQL syncs Postgres into a local IndexedDB (web/native) replica. Mutations queue when offline (Write-Ahead Log on every platform; Service Worker fallback for web shell caches), drain on reconnect, survive crashes. The app keeps working when the network drops.
3. **Self-hosted OTA** for both iOS (Capgo, self-hosted) and Electron (custom shell auto-updater + custom renderer state machine). Ship JS updates as fast as you ship to the web — no Capgo Cloud, no EAS Update, no GitHub Releases dependency. You own the publish-sign-serve-verify loop.

The reference stack is **Vite + React 19 + Tailwind v4 + Hono + Supabase + S3-compatible storage**. The backend framework, auth provider, and object store are all swappable — see [`docs/BACKEND_CONTRACTS.md`](./docs/BACKEND_CONTRACTS.md) for the HTTP+JSON contracts a backend has to satisfy. Compatible with **Bun, Cloudflare Workers, Deno, Express, Fastify, Elysia, Next.js API routes — or PHP, Python, Ruby, Go, Rust, .NET**.

## Quick start

Vitronitor is **client-only at the root**. The server is a swappable
concern — a reference Hono backend lives at [`examples/server-hono/`](./examples/server-hono),
and any backend that satisfies [`docs/BACKEND_CONTRACTS.md`](./docs/BACKEND_CONTRACTS.md)
will work.

Prerequisites: Node 22+, a Supabase project, an Electric source (Cloud
or self-hosted), an S3-compatible bucket for OTA bundles. Plus Caddy
(`brew install caddy && caddy trust`) if you run the reference backend.

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
cp .env.example .env.local        # fill in Supabase + Electric + S3 creds
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
| `lib/electric/collections/generated/note.generated.ts` | Zod schema (codegen output) |
| `lib/electric/collections/notes.ts` | Converters + `createOrgScopedCollection` call |
| `examples/server-hono/server/routes/notes.ts` | POST/PATCH/DELETE behind withAuth, soft-delete on DELETE |
| `lib/hooks/useNotes.ts` | Public API: useNotes / useNote / createNote / updateNote / deleteNote |
| `app/notes/page.tsx` | List view with create + delete |
| `app/notes/[id]/page.tsx` | Detail view with debounced autosave |

## Adding a new collection (6-step recipe)

1. **Migration** — `supabase/migrations/<ts>_add_<table>.sql` with `org_id`
   FK + indexes + RLS policies + `ALTER PUBLICATION supabase_realtime ADD TABLE`.
2. **Type** — `lib/db/types/<name>.ts` with `Db<Name>` (snake_case) and
   `<Name>` (camelCase) interfaces.
3. **Codegen** — add the table to `TABLES[]` in
   `scripts/generate-electric-schemas.ts` and run
   `npx tsx scripts/generate-electric-schemas.ts`.
4. **Collection** — `lib/electric/collections/<name>.ts`: converters +
   `createOrgScopedCollection<Db<Name>Row>({ table, schema, getInsert/Update/DeleteWalParams })`.
5. **Provider** — register in `lib/electric/TanStackDbProvider.tsx`
   (declare the collection in `useMemo`, add a persistence hydrate effect).
6. **Hook + UI** — `lib/hooks/use<Name>.ts` mirrors `useNotes.ts`; pages
   under `app/<name>/`.

`docs/ELECTRIC.md` has the full walkthrough.

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
│   ├── supabase/              browser client + native-storage adapter
│   ├── contexts/              Auth, Org, Network providers
│   ├── db/types/              Db* / app types (notes is the example)
│   ├── electric/              the offline-first sync layer
│   │   ├── TanStackDbProvider Single-collection provider
│   │   │                      (extend for multi-collection — see comments)
│   │   ├── collections/       factory + notes (canonical pattern)
│   │   ├── storage/           PersistenceAdapter + IndexedDB impl
│   │   ├── mutation-wal       offline write-ahead log
│   │   ├── mutation-queue-*   processor that drains pending mutations
│   │   └── tables.ts          shared table list + scope helpers
│   ├── hooks/                 useNotes, useCollection,
│   │                          useCapacitorUpdater, useElectronUpdater,
│   │                          useServiceWorker
│   └── electron/              types.d.ts (window.electronAPI shape)
├── components/                ui/* shadcn primitives, layout/OfflineBanner,
│                              admin/UpdateDebugPanel
├── electron/                  Electron main process + preload + tray + IPC
│   ├── main/index.ts          BrowserWindow, deep-link, single-instance lock
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
│                              SIGNING_KEY, ELECTRIC, SUPABASE, OBJECT_STORE_SETUP,
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
implement the eight endpoints in [`docs/BACKEND_CONTRACTS.md`](./docs/BACKEND_CONTRACTS.md):

- `withAuth` middleware that resolves `user` + `orgId` from a Bearer JWT
- `{ ok, data } | { ok: false, error, code? }` response envelope
- `GET /api/electric/shape` proxy with `org_id` WHERE injection
- `POST /api/notes` / `PATCH /api/notes/:id` / `DELETE /api/notes/:id`
- `POST /api/capacitor/bundle` (iOS Capgo manifest contract)
- `POST /api/electron/bundle` (Electron renderer OTA)
- `GET /api/electron/shell/*` (electron-updater generic provider)

## Swapping out Supabase

The auth seam is the `withAuth` middleware in `examples/server-hono/server/middleware/auth.ts`.
It resolves `c.var.user` + `c.var.orgId` from a Supabase Bearer JWT today.
To swap to Clerk / Auth.js / a hand-rolled JWT setup, replace just that
middleware. See [`docs/AUTH.md`](./docs/AUTH.md).

The database doesn't have to be Supabase Postgres either, but it has to
be Postgres for Electric to work. Self-hosted Postgres + Electric works
the same way; the migrations are plain SQL.

## Documentation index

- **[SETUP.md](./docs/SETUP.md)** — end-to-end first-time setup
- **[ARCHITECTURE.md](./docs/ARCHITECTURE.md)** — Mermaid component + sync-flow + OTA-state-machine diagrams
- **[BACKEND_CONTRACTS.md](./docs/BACKEND_CONTRACTS.md)** — HTTP+JSON spec for backend ports
- **[SUPABASE.md](./docs/SUPABASE.md)** — Supabase project + migration walkthrough
- **[ELECTRIC.md](./docs/ELECTRIC.md)** — Electric source provisioning + 6-step recipe for new collections
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
[Supabase](https://supabase.com), [ElectricSQL](https://electric-sql.com),
[TanStack DB](https://tanstack.com/db), [Capacitor](https://capacitorjs.com),
[Capgo](https://capgo.app), [Electron](https://www.electronjs.org), and
[electron-updater](https://www.electron.build/auto-update). Thanks to
everyone who maintains them.

## License

MIT — see [LICENSE](./LICENSE). By contributing you agree your changes
ship under the same license.
