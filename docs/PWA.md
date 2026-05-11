# PWA + Service Worker

The web target is a Progressive Web App. The SW pre-caches the SPA shell,
serves a structured offline response for `/api/*` failures, and gives the
user a reload prompt when a new build is deployed.

Mutations do **not** use the Background Sync API — the offline-write
path is `@tanstack/offline-transactions` in `lib/sync/offline-executor.ts`,
which works identically on web, Capacitor, and Electron and persists to
SQLite (OPFS wa-sqlite on web/Electron, native SQLite on iOS/Android)
through full app crashes — Background Sync only runs while the page is
in scope.

## What's wired up

- **`public/sw.js`** — the worker. Cache name `vitronitor-v<package.json version>`,
  bumped automatically by `scripts/sync-version.js`.
- **`lib/hooks/useServiceWorker.ts`** — registers the SW, detects new versions,
  exposes `applyUpdate()` (skipWaiting + page reload).
- **`lib/contexts/NetworkContext.tsx`** — exposes `isOnline` from the
  browser's `online`/`offline` events.
- **`components/layout/OfflineBanner.tsx`** — top-of-page banner shown
  when offline OR when a new SW is installed and waiting.

## Verify

```bash
npm run dev
# https://localhost:3000
```

1. Open DevTools → Application → Service Workers. The Vitronitor SW should
   register and become "activated".
2. Toggle DevTools → Network → Offline. The banner should appear at the
   top: "You're offline — changes will sync when you reconnect."
3. Edit a note while offline — local state updates, the mutation is
   captured in the SQLite-backed outbox by the offline executor.
4. Toggle back online — the executor drains; the server reflects the
   change; a Supabase Realtime broadcast triggers `invalidateQueries`
   on every other subscribed device.
5. Bump `package.json` version → `npm run dev` → reload the page. The
   blue banner should appear: "A new version of Vitronitor is available." Click
   Reload.

## Add to home screen (web → installed PWA)

`public/manifest.json` declares the app's metadata. Browsers show the
"Install" prompt automatically once a few heuristics are met (visited
twice over 5 minutes, has manifest, has SW, served over HTTPS).

To add an explicit install button, listen for the `beforeinstallprompt`
event and call `prompt()` on it.

## Notable design choices

- **No background-sync mutation queue** — see the rationale at the top.
- **No push notifications**. Push requires VAPID keys + a server
  endpoint to manage subscriptions. Add when needed by wiring `push` +
  `notificationclick` handlers into `public/sw.js`.
- **Auth pages** are not pre-cached so a stale SPA shell can't serve a
  signed-out look-and-feel after a session change.
- **`/api/sync/:table` is bypassed** by the SW's network-first strategy
  for `/api/*` already — TanStack Query owns its own cache and we don't
  want the SW serving a stale snapshot ahead of an in-flight refetch.
