# Electron desktop target (M7 → M9)

The same React app runs as a desktop app via Electron. M7 wires up the shell
(window, tray, IPC, build); M8 adds the auto-updater for the binary; M9
adds the custom renderer OTA pipeline for shipping JS-only updates without
a native release.

## Prerequisites

- Node 22+
- macOS for Mac builds (notarization needs an Apple Developer cert).
- For Windows / Linux builds: any platform via electron-builder's
  cross-build support (Windows `.exe` builds best on Windows, but you can
  build from a Mac with Wine).

## Run the dev shell

```bash
npm run electron:dev
```

This runs three processes concurrently:
1. Vite (renderer, port 5173)
2. Hono (API, port 3001)
3. Caddy (HTTPS proxy, port 3000) — only relevant for Capacitor; harmless here

…then waits for Vite to be ready and launches Electron pointing at
`http://localhost:5173`. Hot reload works for the renderer; main-process
edits require restarting `electron:dev`.

## Build a local app bundle

```bash
npm run electron:build:mac:dev      # macOS arm64, unsigned, no auto-updater
```

The `.dmg` lands in `dist-electron/`. Drag-install it and launch.

For a real signed + notarized build, set `APPLE_ID`,
`APPLE_APP_SPECIFIC_PASSWORD`, and `APPLE_TEAM_ID` env vars and run:

```bash
npm run electron:build -- --mac
```

(Notarization happens via the `afterSign` hook — left for you to wire up
once you have a Developer cert.)

## What's wired up in M7

- **Single-instance lock** — second launch focuses the existing window
  (essential for OAuth deep links to focus the app instead of opening a
  duplicate).
- **Custom URL scheme `vitronitor://`** — replace in `electron/main/index.ts`
  + `electron-builder.config.cjs` when renaming. Routes to `app:deep-link`
  IPC; the renderer can listen via `window.electronAPI.onDeepLink`.
- **Tray icon** with Show/Quit menu (replace `electron/public/tray-icon.png`).
- **safeStorage-backed key/value store** at `<userData>/storage/*.enc`,
  encrypted with the OS keychain. Used by `lib/supabase/native-storage.ts`
  to back Supabase auth — sessions survive restart, encrypted on disk.
- **electron-builder.config.cjs** (CJS, not JSON) so `publish.url` can
  interpolate `process.env.API_URL` at build time. Ships `.dmg` + `.zip`
  on macOS, `.nsis` on Windows, `.AppImage` on Linux.

## Configuration to swap

Before shipping:

- `electron/main/index.ts` → `PROTOCOL` (deep-link scheme)
- `electron-builder.config.cjs` → `appId`, `productName` (or set
  `ELECTRON_APP_ID`, `ELECTRON_PRODUCT_NAME`, `ELECTRON_URL_SCHEME` env vars)
- `electron/public/tray-icon.png` + `electron/public/icon.png` /
  `icon.ico` (placeholders; provide your own)

## What's coming next

- **M8** — `electron/main/updater.ts` (auto-update the binary via
  electron-updater) + `examples/server-hono/examples/server-hono/server/routes/electron-shell.ts` (Hono proxy that serves
  `latest-mac.yml` / `.dmg` via presigned S3 redirects).
- **M9** — `electron/main/renderer-ota.ts` (active/pending/candidate state
  machine for hot-swapping the renderer bundle without touching the binary)
  + `examples/server-hono/server/routes/electron-bundle.ts` (the manifest endpoint).
