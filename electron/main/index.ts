/**
 * Electron main process entry point.
 *
 * What this does (M7):
 *   1. Single-instance lock — second launch focuses the existing window
 *   2. Custom URL scheme handler (myapp://...) for OAuth deep links
 *   3. BrowserWindow load: dev → http://localhost:5173, prod → file://dist/index.html
 *      (M9 swaps the prod path for the renderer-OTA resolver)
 *   4. Registers IPC: storage (Supabase auth backing) + updater (M8) +
 *      renderer-OTA (M9)
 *   5. Tray icon + minimal app menu
 */

import { app, BrowserWindow, shell } from 'electron';
import * as path from 'path';
import { registerStorageIpc } from './ipc/storage';
import { createTray, destroyTray } from './tray';
import { initAutoUpdater, checkForUpdatesOnStartup } from './updater';
import {
  resolveRendererPath,
  registerRendererOtaIpc,
  scheduleUpdateCheck,
  stopUpdateCheck,
} from './renderer-ota';

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

// Custom protocol — replace with your scheme. Used for OAuth callbacks.
const PROTOCOL = 'vitronitor';

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
    // resolveRendererPath() picks pending → active → bundled.
    // Returns a file:// URL with no fragment; React Router (hash routing)
    // navigates internally from there.
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
