# Electron OTA pipelines

Two independent update pipelines:

| Pipeline | What it ships | Trigger | When |
|---|---|---|---|
| **Shell auto-update** | The compiled binary (.dmg / .zip / .exe / .AppImage) | electron-updater hits `GET /api/electron/shell/latest-mac.yml` on launch + every hour | When you change `electron/main/**`, native deps, or `electron-builder.config.cjs` |
| **Renderer OTA** | The Vite-built JS bundle (`dist/`) | Renderer pings `POST /api/electron/bundle` ~30s after boot + every hour | When you change `src/`, `app/`, `components/`, `lib/`, `public/` (anything renderer-only) |

The **shell update is rare and heavyweight**: requires a Mac with a Developer
cert for notarization, downloads ~100 MB of compressed app, prompts the user
to restart. The **renderer OTA is frequent and cheap**: GitHub-Actions-friendly
build, ~1 MB encrypted JS payload, hot-swaps on next launch with rollback if
the bundle fails to call `notifyReady`.

## Shell auto-update

### Architecture

```
electron-updater (in main process)
   │
   │ GET /api/electron/shell/latest-mac.yml  (no-cache YAML)
   ▼
Hono server (examples/server-hono/server/routes/electron-shell.ts)
   │
   │ presigned GET (1h)
   ▼
S3-compatible bucket
   releases/electron/shell/
     latest-mac.yml
     <ProductName>-<version>-arm64.dmg          ← presigned 302 redirect
     <ProductName>-<version>-arm64-mac.zip      ← electron-updater needs this too
     ...blockmaps for differential updates
```

### Publishing flow

Manually, on the matching native host (Mac for `.dmg`/`.zip`):

```bash
# 1. bump version
npm version 0.1.1 --no-git-tag-version

# 2. build (signed + notarized requires Apple cert env vars)
npm run electron:build -- --mac

# 3. upload to S3
PRODUCT_NAME=Vitronitor bash scripts/publish-electron-shell.sh mac
```

S3 now has `latest-mac.yml` + the new artifacts under
`releases/electron/shell/`. Installed apps detect the update on the next
hourly check or on the next launch.

### Renderer flow

`lib/hooks/useElectronUpdater.ts` exposes `{state, checkForUpdates,
downloadUpdate, installUpdate}`. The `UpdateDebugPanel` at
`/dev/update-debug` is wired to it on Electron just like it's wired to
`useCapacitorUpdater` on iOS.

For production UX, surface a "Restart to apply update" toast when
`state.status === 'downloaded'`. The download is gated on user confirmation
(`autoDownload: false`).

### Common issues

- **"app-update.yml not found"** — happens with `--dir` builds.
  `initAutoUpdater` detects this and disables itself cleanly; full builds
  ship the file.
- **Cached `latest-mac.yml`** — Chromium's HTTP cache used by
  `electron.net` aggressively caches YAML. The boilerplate sets
  `autoUpdater.requestHeaders = { 'Cache-Control': 'no-store, no-cache' }`,
  AND the Hono proxy sets `Cache-Control: no-store, no-cache, must-revalidate`
  on the YAML response. Both are needed.
- **electron-builder missing the .zip** — the macOS `target` config must
  include both `dmg` and `zip`; electron-updater downloads from the .zip
  for the squashed delta.

## Renderer OTA

Hot-swap the JS bundle without touching the binary. Same RSA-signed wire
format as iOS Capgo (same `.capgo_key_v2` signs both), same
notifyReady-or-rollback semantics.

### State machine

State persisted at `<userData>/renderer/state.json`:

```json
{
  "active": "1.42.0",     // last confirmed-good
  "pending": "1.43.0",    // staged for next boot
  "candidate": "1.42.0",  // loaded this boot, awaiting notifyReady
  "lastCheck": "2026-05-04T07:37:16Z"
}
```

Boot picks `pending` → `active` → `bundled`, in that order. If a candidate
from the prior boot didn't confirm (`notifyReady` never fired in
`src/main.tsx`), `resolveRendererPath` rolls back: drops the slot the
candidate came from, schedules its directory for deletion, loads the next
viable choice. So a bad pending falls back to active, not bundled.

### Server endpoint

`POST /api/electron/bundle` mirrors `/api/capacitor/bundle` plus a
`min_native_version` field. Refuses to serve a bundle to an Electron shell
older than what the bundle requires (so you can ship a renderer that uses
new IPC methods without breaking installed users on the old shell).

### Publishing

```bash
# Manual
npm run electron:publish-bundle

# Automatic (on push to main when renderer paths change)
.github/workflows/electron-bundle.yml
```

The CI workflow computes `OTA_VERSION` as `major.minor.commit-count` so
versions always increase without manual bumps. It explicitly excludes
`electron/main/**` from the trigger paths — those changes need the full
shell release path (`scripts/publish-electron-shell.sh`) because they're
binary-level.

### Verification

```bash
# 1. Install version 1.0.0 of the shell
npm run electron:build:mac:dev
open dist-electron/Vitronitor-1.0.0-arm64.dmg
# (drag-install + launch)

# 2. Publish a new renderer bundle
OTA_VERSION=1.0.1 npm run electron:publish-bundle

# 3. Restart the installed app — ~30s post-boot it fetches + downloads
#    + verifies the bundle, marks it as `pending`. Restart again — it
#    loads the pending bundle, fires notifyReady (src/main.tsx), promotes
#    it to active. Restart a third time — it loads from `active`.
```

### Failure modes

- **Renderer crashes before mount** — notifyReady never fires. Next boot's
  `resolveRendererPath` sees the unconfirmed candidate, rolls back: drops
  the pending (or active) slot it came from, deletes the broken directory,
  loads the next viable choice.
- **Decryption / signature failure** — staged bundle is deleted, `pending`
  unchanged, status returned to renderer as `error`.
- **min_native_version floor** — the server returns `{}`, renderer treats
  as up-to-date and skips.

### State file recovery

If `state.json` is corrupted, `loadState()` falls back to the empty state
which boots from the bundled renderer. Worst case: lose OTA history; app
still works.
