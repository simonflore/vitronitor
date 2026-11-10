# CLAUDE.md

Guidance for Claude Code working in this repository.

A rule belongs here only if it applies to **every** session and can't be learned by reading the code. Everything else lives in `docs/`, and this file links to it.

## Orientation

**Vitronitor is a boilerplate**, not an app: one React codebase for web (PWA) + iOS + Android (Capacitor) + desktop (raw Electron), offline-first through a TanStack DB mutation outbox, with self-hosted OTA on all four targets. It is the generalised core of [gigmeister](https://github.com/simonflore/gigmeister); reliability fixes there are backported here (`backport/gigmeister-*` branches).

Changes must generalise to *any* fork. App-specific features are out of scope (see [CONTRIBUTING.md](./CONTRIBUTING.md#whats-out-of-scope)).

**Stack:** Vite 8 · React 19 · React Router 8 · TypeScript 6 (strict) · Tailwind v4 · Supabase (auth + Postgres + Realtime) · TanStack Query/DB + offline-transactions · Capacitor 8 + Capgo · Electron 43 · Vitest.

**Client-only at the root.** The reference backend is a separate package in [`examples/server-hono/`](./examples/server-hono). Any backend that meets [`docs/BACKEND_CONTRACTS.md`](./docs/BACKEND_CONTRACTS.md) works.

**Entry points:**
- Client: `src/main.tsx` → `src/App.tsx` → `src/router.tsx`
- Sync: `lib/sync/` (collections, `offline-executor.ts`, `TanStackDbProvider.tsx`), realtime in `lib/realtime/`
- Electron main: `electron/main/index.ts` (renderer OTA in `renderer-ota.ts`)

## Non-negotiables

| Rule | Where |
|---|---|
| `apiFetch` for every `/api/*` call, never raw `fetch` (it resolves the per-platform base URL and attaches the token) | `lib/api-client.ts` |
| Writes go through the offline-transactions outbox, never straight to the API | `lib/sync/offline-executor.ts`, [ARCHITECTURE](./docs/ARCHITECTURE.md#sync-flow-sequence) |
| Permanent server errors throw `NonRetriableError` so the entry dead-letters instead of looping | `lib/sync/offline-executor.ts` |
| No `any`, no `@ts-ignore`, no relative `../../../`: use `@/` | — |
| No vendor lock-in: Supabase, the backend and the object store stay swappable | [BACKEND_CONTRACTS](./docs/BACKEND_CONTRACTS.md), [AUTH](./docs/AUTH.md) |
| Never commit signing keys (`.capgo_key_v2`, `*.pem`) or `.env.local` | `.gitignore`, [SIGNING_KEY](./docs/SIGNING_KEY.md) |
| New deps need a strong reason. The dep list is small on purpose | [CONTRIBUTING](./CONTRIBUTING.md) |

## Dependencies

- **The TanStack DB family is pinned exactly** (`@tanstack/react-db`, `offline-transactions`, `query-db-collection`, `*-db-sqlite-persistence`), with `@tanstack/db` forced through `overrides`. These are 0.x packages that break on minors and must agree on one `@tanstack/db`; caret ranges once pulled two copies and broke both typecheck and build. Bump them together, to the versions gigmeister resolves.
- Install with `--legacy-peer-deps` (same as CI).
- Keep versions aligned with gigmeister where the two share a package; that keeps backports clean.

## Commands

```bash
npm run dev                 # Vite SPA on :5173 (proxies /api → :3001)
npm run build               # production web build
npm run electron:dev        # Vite + Electron
npm run cap:sync            # build for Capacitor and sync native projects

# Gates: run all of these before committing (CI runs the same set)
npm run lint                # ESLint, --max-warnings 0
npm run typecheck           # tsc for web AND electron/tsconfig.json
npm run test:run            # vitest (jsdom)
npm run knip                # unused files, exports, deps
```

Husky runs lint-staged on commit and both typechecks on push.

### CI gates

`.github/workflows/ci.yml` runs on GitHub-hosted runners (public repo: fork PRs must not reach self-hosted infra): lint, typecheck (web + electron), tests with coverage, web build, lockfile drift, knip, and `npm audit --omit=dev --audit-level=high`.

## Working with automated code review (Codex)

Weigh each finding by real impact:

- **Fix it**: real bugs, data loss, security holes on paths that exist, anything failing CI. Proper fix plus a test.
- **Note or skip it**: theoretical edges, style nits with no user impact. A one-line reply.
- **Escalate, don't grind**: when the real fix is a redesign, say so once, file an issue, move on.

The mechanics live in [`/codex-review`](./.claude/skills/codex-review/SKILL.md).

## Gotchas

- **Node 25+ ships an experimental global `localStorage`** that shadows jsdom's. `vitest.config.ts` passes `--no-experimental-webstorage`; keep it.
- **`eslint-plugin-react` cannot auto-detect the React version under ESLint 10** (`context.getFilename` is gone). The version is set explicitly in `eslint.config.mjs`; bump it with React.
- **`electron/` is excluded from the root tsconfig.** Type errors there only show up through `tsc -p electron/tsconfig.json` (part of `npm run typecheck`).
- **knip exceptions are boilerplate surface** for forks (Electron updater hook, platform helpers, natively registered Capacitor plugins). They are listed with reasons in `knip.config.ts`; don't add an entry without one.
- **The service worker's `CACHE_NAME` is stamped per build** by a Vite plugin (`vite.config.ts`). Don't hand-edit it in `dist/`.

## Docs map

| Topic | File |
|---|---|
| Architecture, sync flow, OTA state machine | [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) |
| First-time setup | [docs/SETUP.md](./docs/SETUP.md) |
| Backend contracts | [docs/BACKEND_CONTRACTS.md](./docs/BACKEND_CONTRACTS.md) |
| Auth and swapping providers | [docs/AUTH.md](./docs/AUTH.md) |
| Capacitor / Electron / Electron OTA / PWA | [CAPACITOR](./docs/CAPACITOR.md) · [ELECTRON](./docs/ELECTRON.md) · [ELECTRON_OTA](./docs/ELECTRON_OTA.md) · [PWA](./docs/PWA.md) |
| Release signing, fastlane, object store | [SIGNING_KEY](./docs/SIGNING_KEY.md) · [FASTLANE](./docs/FASTLANE.md) · [OBJECT_STORE_SETUP](./docs/OBJECT_STORE_SETUP.md) |
| Adding a collection | [README.md](./README.md#adding-a-new-collection-6-step-recipe) |

Update `CHANGELOG.md` under "Unreleased" for any user-facing change.
