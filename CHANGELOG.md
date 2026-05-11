# Changelog

## Unreleased — TanStack-only sync

The sync layer is now TanStack-native end-to-end. ElectricSQL and the
custom Write-Ahead Log are gone; the offline-first guarantees come from
`@tanstack/offline-transactions` + SQLite persistence on every target.

### Changed

- **Sync layer rewrite**: `lib/electric/` → `lib/sync/`. Reads now flow
  through `@tanstack/query-db-collection` over `GET /api/sync/:table`;
  writes flow through `@tanstack/offline-transactions` with idempotency
  keys and `NonRetriableError` dead-lettering for permanent (404/410/422)
  server errors. Cross-device propagation runs via Supabase Realtime
  broadcast (`{ table, op, id }` on `org:${orgId}`) → `invalidateQueries`.
- **Persistence**: `@tanstack/browser-db-sqlite-persistence` (OPFS-backed
  wa-sqlite) on web and Electron renderer; `@tanstack/capacitor-db-sqlite-persistence`
  + `@capacitor-community/sqlite` on iOS and Android. One per-user `.db`
  file scopes cached rows per Supabase user id.
- **Electron OPFS origin**: registered the `app://` scheme as a privileged
  standard scheme and serve the renderer through it in production. OPFS
  requires a real origin; the previous `file://` load couldn't provide one.
  A `protocol.handle('app', …)` callback streams files from the active
  renderer dist directory (OTA-aware) and injects a CSP per response.

### Removed

- `@tanstack/electric-db-collection` dep and all ElectricSQL integration:
  the `/api/electric/shape` Hono proxy, `ELECTRIC_API_URL` / `ELECTRIC_SOURCE_ID` /
  `ELECTRIC_SOURCE_SECRET` env vars, and `@electric-sql/client` from the
  server example's dependencies.
- The custom mutation Write-Ahead Log (`mutation-wal.ts`,
  `mutation-queue-processor.ts`, `MutationQueueProcessorProvider`) and
  the hand-rolled storage adapters (IndexedDB, no-persistence) under
  `lib/electric/storage/`. `@tanstack/offline-transactions` covers the
  same surface with broader runtime support and shared upstream tests.

### Added

- `@tanstack/react-query` + a shared `lib/query-client.ts` singleton.
- `lib/realtime/broadcast-listener.tsx` and `examples/server-hono/server/lib/broadcast.ts`
  for cross-device propagation.
- `examples/server-hono/server/routes/sync.ts` — bulk-read endpoint scoped
  by `org_id` with an allowlist drawn from `lib/sync/config.ts`.

## 0.1.0 — initial cut

The first complete pass of Vitronitor — a cross-platform offline-first React boilerplate distilled from a production SaaS platform layer.

### Added

- **Build + reference backend**: Vite + React 19 + Tailwind v4 + Caddy HTTP/2 dev proxy + Hono
  reference backend with `/api/health`, response envelope helpers, security
  headers middleware, env validator that fails fast at boot.
- **Auth + notes API**: Supabase magic-link auth, server-side `withAuth` middleware
  (Bearer + org resolution), notes table with RLS + soft-delete + auto-org
  trigger, plain CRUD API. Auth seam documented for backend ports.
- **Sync (initial Electric-based cut)**: client-side TanStackDbProvider
  (single-collection; extend for multi-collection), persistence layer with
  IndexedDB adapter, custom Write-Ahead Log for offline mutations
  (insert+update merge, insert+delete cancel, exponential backoff with
  jitter), mutation queue processor with online-event + 30s polling drain.
  Notes pages list + detail with debounced autosave. Codegen script for
  Zod schemas. *(Replaced wholesale in Unreleased — see above.)*
- **Service Worker**: Real Service Worker (cache-first static, network-first /api,
  structured offline JSON fallback). NetworkContext from browser
  online/offline events. SW registration hook with update detection +
  reload prompt. Offline banner.
- **Capacitor iOS**: Capacitor iOS scaffolding (config, native-storage adapter for
  Supabase auth via @capacitor/preferences, Network plugin alongside
  navigator.onLine). Fastlane Appfile/Matchfile/Fastfile with beta +
  release lanes. Custom plugin registration script (no plugins shipped;
  `npm init @capacitor/plugin@latest` is the path).
- **iOS OTA pipeline**: Self-hosted iOS Capgo OTA pipeline. RSA-signed bundles via
  Capgo CLI. POST /api/capacitor/bundle endpoint with semver gate + presigned
  URLs. setup-signing-key.sh for one-time signing key generation.
  publish-capacitor-bundle.sh build+sign+upload. UpdateDebugPanel UI.
  GitHub Actions workflow for auto-publish on push to main with
  major.minor.commit-count versioning.
- **Electron shell**: Electron main process (BrowserWindow, single-instance lock,
  vitronitor:// deep-link handler, hiddenInset title bar). contextBridge
  preload surface. Tray icon. ipc/storage.ts safeStorage-backed
  encrypted KV at `<userData>/storage/*.enc` (used by Supabase
  native-storage). electron-builder.config.cjs (CJS for env interp).
- **Electron auto-updater**: electron-updater wrapper (autoDownload=false, hourly check,
  startup retry with backoff, disables cleanly when app-update.yml is
  missing). GET /api/electron/shell/* generic-HTTP feed (inline no-cache YAML
  manifests, presigned 302 redirects for binaries). useElectronUpdater
  hook. Cross-platform publish script with PRODUCT_NAME env var.
- **Electron renderer OTA**: Custom renderer OTA state machine
  (active/pending/candidate, notifyReady-or-rollback). RSA-PKCS1 +
  AES-128-CBC same wire format as iOS Capgo (one .capgo_key_v2 signs
  both). POST /api/electron/bundle with min_native_version
  floor. publish-electron-bundle.sh + GitHub Actions workflow that
  excludes electron/main/** (those need the manual shell publish path).
  notifyReady wired in src/main.tsx so a lazy-chunk failure doesn't
  permanently break a working bundle.
- **Android + docs**: Android target documented (same Capgo pipeline works).
  scripts/setup.sh interactive placeholder rewrite. Architecture diagrams
  in docs/ARCHITECTURE.md (Mermaid). docs/BACKEND_CONTRACTS.md HTTP+JSON
  spec. docs/AUTH.md auth seam swap recipes. Final README pass.

### Known limitations

- iOS / Android folders are not committed — generated via `npx cap add`.
- Custom Capacitor plugin example is the official `npm init @capacitor/plugin`
  scaffold; no in-tree plugin shipped.
- Push notifications scaffold is left out (the SW has no push handler;
  add when needed).
- No e2e tests yet.
