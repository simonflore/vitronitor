/**
 * Electron main process entry point.
 *
 * What this does:
 *   1. Single-instance lock — second launch focuses the existing window
 *   2. Custom URL scheme handler (myapp://...) for OAuth deep links
 *   3. BrowserWindow load: dev → http://localhost:5173, prod → file://dist/index.html
 *      (the prod path is swapped for the renderer-OTA resolver when active)
 *   4. Registers IPC: storage (Supabase auth backing) + auto-updater +
 *      renderer-OTA
 *   5. Tray icon + minimal app menu
 */

import { app, BrowserWindow, net, protocol, shell } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { pathToFileURL } from 'url';
import { registerStorageIpc } from './ipc/storage';
import { createTray, destroyTray } from './tray';
import { initAutoUpdater, checkForUpdatesOnStartup } from './updater';
import {
  resolveRendererPath,
  getActiveRendererDir,
  registerRendererOtaIpc,
  scheduleUpdateCheck,
  stopUpdateCheck,
} from './renderer-ota';

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

// Custom protocol — replace with your scheme. Used for OAuth callbacks.
const PROTOCOL = 'vitronitor';

// Register the `app://` scheme as a privileged standard scheme BEFORE
// app.whenReady so the renderer gets a real (non-opaque) origin. Required for
// secure-context features like OPFS, Service Workers with persistence, and a
// well-defined storage quota. Production-only — dev mode loads from
// http://localhost:5173 which is already a real origin.
if (!isDev) {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: 'app',
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        codeCache: true,
        stream: true,
      },
    },
  ]);
}

// Single-instance lock — second invocation focuses the existing window
// (instead of opening a duplicate). Required for deep links to focus the
// already-running app.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
  process.exit(0);
}

let mainWindow: BrowserWindow | null = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 640,
    minHeight: 480,
    backgroundColor: '#0a0a0a',
    title: 'Vitronitor',
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    // resolveRendererPath() picks pending → active → bundled and records the
    // chosen dist directory; the `app://` protocol handler (below) serves
    // files from that directory. Returns an `app://` URL — React Router
    // (hash routing) navigates internally from there.
    mainWindow.loadURL(resolveRendererPath());
  }

  // External links open in the default browser instead of the Electron window.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Deep-link handler for myapp://… URLs.
function handleDeepLink(url: string) {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
  mainWindow.webContents.send('app:deep-link', url);
}

// Register protocol handler (Mac uses 'open-url'; Windows/Linux pass via argv).
if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [path.resolve(process.argv[1])]);
  }
} else {
  app.setAsDefaultProtocolClient(PROTOCOL);
}

app.on('open-url', (event, url) => {
  event.preventDefault();
  handleDeepLink(url);
});

app.on('second-instance', (_event, argv) => {
  // Windows/Linux: deep-link URL arrives in argv on second-instance.
  const deepLink = argv.find((a) => a.startsWith(`${PROTOCOL}://`));
  if (deepLink) handleDeepLink(deepLink);
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

app.whenReady().then(async () => {
  // Production: serve the renderer over the registered `app://` scheme. The
  // handler maps `app://vitronitor/<path>` to `<activeRendererDir>/<path>`,
  // resolving to the OTA-staged or bundled dist depending on what
  // resolveRendererPath() picked at boot. Using net.fetch on a file:// URL
  // gives correct MIME types and range-request handling for free.
  if (!isDev) {
    protocol.handle('app', async (request) => {
      const url = new URL(request.url);
      // Reject any host other than `vitronitor`. Standard schemes treat the
      // host as part of the origin — accepting arbitrary hosts would let the
      // same bundle run under multiple `app://` origins with separate
      // storage partitions, defeating the point of a real origin.
      if (url.host !== 'vitronitor') {
        return new Response('Forbidden', { status: 403 });
      }
      const requestedPath = url.pathname === '/' ? '/index.html' : url.pathname;
      const root = getActiveRendererDir();
      const lexical = path.resolve(path.join(root, requestedPath));

      // Lexical guard rejects `..` segments, but a symlink inside an OTA
      // bundle could still point outside `root`. Resolve realpath on both
      // sides and compare. If the file doesn't exist, realpath throws — we
      // surface that as 404 so missing assets don't crash the handler.
      let resolved: string;
      let rootReal: string;
      try {
        resolved = fs.realpathSync(lexical);
        rootReal = fs.realpathSync(root);
      } catch {
        return new Response('Not Found', { status: 404 });
      }
      if (resolved !== rootReal && !resolved.startsWith(rootReal + path.sep)) {
        return new Response('Forbidden', { status: 403 });
      }

      const fileResponse = await net.fetch(pathToFileURL(resolved).toString());
      // Inject a CSP so a compromised renderer (stored XSS, tampered OTA
      // bundle past the checksum check) can't fetch arbitrary remote scripts.
      // wasm-unsafe-eval is required for wa-sqlite. style-src 'unsafe-inline'
      // covers React inline-style props. connect-src lists Supabase REST +
      // Realtime + your API host (edit per deployment).
      const headers = new Headers(fileResponse.headers);
      headers.set(
        'Content-Security-Policy',
        [
          "default-src 'self'",
          "script-src 'self' 'wasm-unsafe-eval'",
          "style-src 'self' 'unsafe-inline'",
          "font-src 'self' data:",
          "img-src 'self' data: blob: https:",
          "media-src 'self' blob: https:",
          "worker-src 'self' blob:",
          // `data:` is required for the wa-sqlite OPFS worker, which ships
          // its WASM inlined as `data:application/wasm;base64,...`.
          "connect-src 'self' data: https://*.supabase.co wss://*.supabase.co",
          "frame-src 'none'",
          "object-src 'none'",
          "base-uri 'self'",
          "form-action 'self'",
        ].join('; '),
      );
      return new Response(fileResponse.body, {
        status: fileResponse.status,
        statusText: fileResponse.statusText,
        headers,
      });
    });
  }

  registerStorageIpc();
  registerRendererOtaIpc();

  createWindow();
  createTray(() => mainWindow);

  if (mainWindow) {
    initAutoUpdater(mainWindow);
    // Don't block app start on the updater check — fire-and-forget.
    checkForUpdatesOnStartup().catch((err) =>
      console.error('[updater] startup check error:', err),
    );
  }

  // Renderer OTA: initial check ~30s post-boot, then hourly. No-op in dev.
  scheduleUpdateCheck();

  app.on('activate', () => {
    // macOS: clicking the dock icon with no windows open recreates one.
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  // macOS keeps the app alive in the dock; everywhere else, full quit.
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  stopUpdateCheck();
  destroyTray();
});
