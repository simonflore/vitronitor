// Vitronitor Service Worker.
//
// CACHE_NAME is auto-synced from package.json by scripts/sync-version.js.
// Bumping the version invalidates all old caches on activate.
//
// What this SW does:
//   - Pre-caches a small static set on install (the SPA shell + manifest)
//   - GET /api/* → network-first, JSON offline fallback (so apiFetch sees
//     a structured error instead of a network failure)
//   - GET /api/electric/shape → bypassed entirely (long-polling; cache useless,
//     intercepting just doubles every pending request in DevTools)
//   - Non-GET /api/* → bypassed (mutations route through the Electric WAL +
//     mutation queue processor — that's the offline-first write path,
//     not Background Sync API)
//   - SPA shell navigations → network-first, cached fallback, basic offline page
//   - Static assets → cache-first with background refresh

const CACHE_NAME = 'vitronitor-v0.1.0';

const STATIC_ASSETS = ['/', '/index.html', '/manifest.json'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      // Cache each asset individually so a single failure doesn't break install.
      await Promise.allSettled(
        STATIC_ASSETS.map(async (url) => {
          try {
            const r = await fetch(url);
            if (r.ok) await cache.put(url, r);
          } catch (e) {
            console.warn(`[sw] precache miss ${url}:`, e);
          }
        }),
      );
    }),
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(
        names.filter((n) => n.startsWith('vitronitor-') && n !== CACHE_NAME).map((n) => caches.delete(n)),
      ),
    ),
  );
  self.clients.claim();
});

// Allow page → SW messaging for "skipWaiting" prompts when a new SW is installed.
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Only intercept same-origin
  if (url.origin !== self.location.origin) return;

  // Mutations bypass the SW (the Electric WAL handles offline writes)
  if (request.method !== 'GET') return;

  // /api routes — network-first, structured offline fallback
  if (url.pathname.startsWith('/api/')) {
    if (url.pathname.startsWith('/api/electric/shape')) return; // long-poll, don't intercept
    event.respondWith(
      fetch(request).catch(
        () =>
          new Response(JSON.stringify({ ok: false, error: 'offline' }), {
            status: 503,
            headers: {
              'Content-Type': 'application/json',
              'X-Offline-Mode': 'true',
            },
          }),
      ),
    );
    return;
  }

  // SPA navigations — network-first with cache fallback
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(request, clone));
          return res;
        })
        .catch(async () => {
          const cached = await caches.match(request);
          if (cached) return cached;
          const shell = await caches.match('/');
          if (shell) return shell;
          return new Response(offlineHtml(), {
            status: 200,
            headers: { 'Content-Type': 'text/html' },
          });
        }),
    );
    return;
  }

  // Static assets — cache-first, background refresh
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) {
        fetch(request)
          .then((res) => {
            if (res.ok) caches.open(CACHE_NAME).then((c) => c.put(request, res));
          })
          .catch(() => {});
        return cached;
      }
      return fetch(request)
        .then((res) => {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(request, clone));
          return res;
        })
        .catch(() => new Response('Offline', { status: 503 }));
    }),
  );
});

function offlineHtml() {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Vitronitor — offline</title>
    <style>
      body { font-family: system-ui, -apple-system, sans-serif; background: #0a0a0a; color: #f5f5f5; display: grid; place-items: center; min-height: 100vh; margin: 0; }
      .card { max-width: 24rem; padding: 2rem; text-align: center; }
      h1 { font-size: 1.25rem; margin-bottom: .5rem; }
      p { color: #a1a1aa; margin-bottom: 1.5rem; font-size: .875rem; }
      button { background: #6366f1; color: white; border: 0; padding: .5rem 1rem; border-radius: .375rem; font: inherit; cursor: pointer; }
      button:hover { background: #4f46e5; }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>You're offline</h1>
      <p>This page wasn't cached yet. Reconnect and try again.</p>
      <button onclick="location.reload()">Retry</button>
    </div>
  </body>
</html>`;
}
