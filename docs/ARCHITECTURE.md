# Architecture

## Component diagram (C4-ish)

```mermaid
flowchart TB
    subgraph Client["Client (web / iOS / Android / Electron)"]
        UI[React UI]
        TSDB["TanStack DB collections<br/>(@tanstack/query-db-collection)"]
        OE["@tanstack/offline-transactions<br/>OfflineExecutor"]
        SQ[("OPFS wa-sqlite (web/Electron)<br/>@capacitor-community/sqlite (iOS/Android)")]
        SS[(Supabase auth<br/>storage)]
        BL["Realtime broadcast listener"]
        SW[Service Worker<br/>web only]
    end

    subgraph Server["Hono API server (Node)"]
        AUTH[withAuth middleware]
        Sync["/api/sync/:table<br/>bulk read"]
        Notes["/api/notes CRUD"]
        BC[broadcastChange<br/>helper]
        OTA1["/api/capacitor/bundle<br/>iOS Capgo"]
        OTA2["/api/electron/bundle"]
        Releases["/api/electron/shell/*<br/>electron-updater"]
    end

    subgraph Backends["External"]
        SBA[Supabase Auth + Postgres + Realtime]
        S3[(S3-compatible<br/>OTA bucket)]
    end

    UI <--> TSDB
    TSDB <--> OE
    TSDB <--> SQ
    UI <--> SS
    UI -.web only.-> SW

    TSDB -- GET /api/sync/:table --> AUTH
    OE -- POST/PATCH/DELETE --> AUTH
    AUTH --> Sync
    AUTH --> Notes
    Notes --> SBA
    Notes -- after each mutation --> BC
    BC -- /realtime/v1/api/broadcast --> SBA
    Sync --> SBA
    SBA -- broadcast on org:${orgId} --> BL
    BL -- invalidateQueries([table]) --> TSDB
    OTA1 --> S3
    OTA2 --> S3
    Releases --> S3
```

## Sync flow (sequence)

```mermaid
sequenceDiagram
    autonumber
    actor U as User
    participant UI as React UI
    participant C as TanStack DB collection
    participant E as OfflineExecutor
    participant API as Hono API
    participant DB as Postgres
    participant RT as Supabase Realtime
    participant B as BroadcastListener<br/>(other devices)

    U->>UI: edit note
    UI->>E: action({ id, changes })
    E->>C: optimistic update
    Note right of C: UI re-renders immediately

    alt online
        E->>+API: PATCH /api/notes/:id<br/>X-Idempotency-Key
        API->>+DB: UPDATE notes SET ... WHERE id = ? AND org_id = ?
        DB-->>-API: row updated
        API->>RT: POST /realtime/v1/api/broadcast<br/>{ table:'notes', op:'update', id }
        API-->>-E: 200 OK
        E->>E: drop from outbox
        RT-->>B: change event on org:${orgId}
        B->>B: invalidateQueries(['notes'])
        B->>API: GET /api/sync/notes
        API-->>B: rows
        B->>C: refresh
    else offline
        E-->>E: persist to outbox, schedule retry
        Note right of E: optimistic state stays
        Note right of E: minutes/hours later, network back
        E->>+API: PATCH /api/notes/:id (retry)
        API->>+DB: UPDATE
        DB-->>-API: ok
        API->>RT: broadcast
        API-->>-E: 200
        E->>E: drop from outbox
    end
```

## OTA state machine (Electron renderer)

```mermaid
stateDiagram-v2
    [*] --> Boot
    Boot --> CheckCandidate

    CheckCandidate --> Rollback: candidate from prior boot<br/>did not confirm
    Rollback --> PickRenderer: drop candidate's slot

    CheckCandidate --> PickRenderer: no stale candidate

    PickRenderer --> LoadPending: pending exists<br/>and dist/index.html present
    PickRenderer --> LoadActive: no pending<br/>or pending broken
    PickRenderer --> LoadBundled: no pending<br/>and no active

    LoadPending --> AwaitNotifyReady
    LoadActive --> AwaitNotifyReady
    LoadBundled --> AwaitNotifyReady

    AwaitNotifyReady --> Confirmed: src/main.tsx<br/>called notifyReady
    AwaitNotifyReady --> [*]: app crashed<br/>before notifyReady

    Confirmed --> Active: pending → active<br/>(pending = null)<br/>or active re-affirmed
    Active --> [*]: ready
```

## OTA flow (publish + install)

```mermaid
sequenceDiagram
    autonumber
    participant Dev as Developer
    participant CI as GitHub Actions
    participant S3 as S3 bucket
    participant API as Hono API
    participant App as Installed app

    Dev->>CI: git push to main<br/>(renderer paths changed)
    CI->>CI: build SPA<br/>RSA-sign + AES-encrypt
    CI->>S3: upload bundle.zip<br/>+ manifest.json

    Note over App: ~30s post-boot tick<br/>or 1h interval
    App->>+API: POST /api/electron/bundle<br/>{version_name, native_version}
    API->>S3: GET manifest.json (presigned, cached 60s)
    S3-->>API: {version, key, checksum, sessionKey, min_native_version}
    API->>API: semver gate +<br/>min_native_version floor
    API-->>-App: {version, url, checksum, session_key, min_native_version}

    App->>S3: GET bundle.zip (presigned 1h)
    S3-->>App: encrypted bytes
    App->>App: RSA-decrypt session key<br/>AES-decrypt body<br/>verify checksum<br/>extract dist/
    App->>App: write to <userData>/renderer/<version>/<br/>state.pending = version

    Note over App: user restarts
    App->>App: resolveRendererPath() → pending<br/>state.candidate = version
    App->>App: src/main.tsx → notifyReady
    App->>App: state.active = candidate<br/>state.pending = null<br/>state.candidate = null
```

## What lives where (file layout)

| Concern | Owner |
|---|---|
| Build/runtime config | `vite.config.ts`, `tsconfig.json`, `Caddyfile` |
| Vite SPA entry | `src/{main,App,router}.tsx` |
| Hono API | `examples/server-hono/server/{index,app}.ts`, `examples/server-hono/server/routes/*` |
| Auth seam | `examples/server-hono/server/middleware/auth.ts` |
| Response envelope | `examples/server-hono/server/lib/response.ts` |
| Sync read endpoint | `examples/server-hono/server/routes/sync.ts` (allowlist + org-filter) |
| Sync write endpoints | `examples/server-hono/server/routes/notes.ts` (or `<name>.ts` per collection) |
| Broadcast emit | `examples/server-hono/server/lib/broadcast.ts` |
| Sync provider | `lib/sync/TanStackDbProvider.tsx` |
| Sync collection pattern | `lib/sync/collections/{factory,notes}.ts` |
| Sync allowlist + scope helpers | `lib/sync/config.ts` |
| Offline outbox | `lib/sync/offline-executor.ts` (`@tanstack/offline-transactions`) |
| Broadcast listener | `lib/realtime/broadcast-listener.tsx` |
| Query client | `lib/query-client.ts` |
| Service Worker | `public/sw.js` |
| Electron main | `electron/main/{index,preload,tray,updater,renderer-ota}.ts` |
| Electron `app://` handler | `electron/main/index.ts` (`protocol.registerSchemesAsPrivileged` + `protocol.handle('app', …)`) |
| Electron auth backing | `electron/main/ipc/storage.ts` (safeStorage) |
| OTA signing | `.capgo_key_v2` (gitignored) + `setup-signing-key.sh` |
| OTA publish | `scripts/publish-{capacitor,electron}-bundle.sh` + `publish-electron-shell.sh` |
| OTA endpoints | `examples/server-hono/server/routes/{capacitor-bundle,electron-bundle,electron-shell}.ts` |
| OTA pickup | iOS: `@capgo/capacitor-updater` plugin auto-checks; Electron renderer: `electron/main/renderer-ota.ts` |

## Decisions worth knowing

- **Hash routing** — `createHashRouter` everywhere. The same React app
  works in dev, prod (Hono-served), Capacitor (`capacitor://localhost`),
  and Electron (`app://vitronitor/`) without server-side routing config
  or build-time base URL games.
- **`app://` for the Electron renderer** — `file://` origins are
  *opaque*: OPFS quota is undefined, Service Workers won't register,
  and shared-array-buffer features won't activate. We register `app://`
  as a privileged standard scheme and serve `dist/` through a
  `protocol.handle('app', …)` callback so the renderer runs under a
  real origin. The handler also injects a CSP per response — tampering
  with a downloaded OTA bundle past the checksum check can't escalate
  to remote-script execution.
- **Raw Electron, not Capacitor-Community-Electron** — Capacitor
  technically targets desktop via the Community Electron platform, but
  it's a thin wrapper that gives you a Capacitor-flavoured app, not a
  real Electron one: tray + multi-window + deep IPC + safeStorage +
  native Node modules in the main process all become second-class.
  Vitronitor builds its own Electron shell (`electron/main/`) and
  shares only the Vite/React renderer with Capacitor. Two purpose-built
  native shells, one renderer.
- **Read path is plain HTTP, not streaming** — `@tanstack/query-db-collection`
  fetches `GET /api/sync/:table` and TanStack Query owns the cache.
  Cross-device freshness comes from Supabase Realtime broadcasts on
  `org:${orgId}` triggering `invalidateQueries`. There's no bespoke
  long-poll or SSE protocol to host or operate — any backend that can
  return `{ ok: true, data: [...rows] }` and post a `change` payload
  to a pub/sub channel is enough.
- **Offline outbox via `@tanstack/offline-transactions`** — every write
  is wrapped in `executor.createOfflineAction({ mutationFnName, onMutate })`
  so it persists to the durable outbox before reaching the network.
  Retries thread an idempotency key; permanent failures (404/410/422)
  throw `NonRetriableError` so the entry dead-letters instead of
  looping forever. Survives full app crashes — not just tab closes.
- **SPA shell for prod** — Hono serves `dist/` with a `*` fallback to
  `index.html`. Electron uses the same `index.html` via the renderer-OTA
  resolver in production, served through `app://vitronitor/`.
- **Single-org default** — the `on_auth_user_created` Postgres trigger
  creates one workspace per new user. The `withAuth` middleware
  resolves `orgId` to the user's first `org_members` row. Multi-org is
  a documented extension: drop the trigger, send `X-Org-Id` from the
  client, and tear down + recreate the sync collections on switch.
- **One key signs both OTAs** — `.capgo_key_v2` signs both iOS Capgo
  and Electron renderer bundles. Same RSA-PKCS1 + AES-128-CBC wire
  format, same public PEM in two files (`capacitor.config.ts` +
  `electron/main/renderer-ota.ts`).
