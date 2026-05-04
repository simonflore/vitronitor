/**
 * Renderer ↔ main process bridge.
 *
 * The exposed `window.electronAPI` is the entire surface the React app sees
 * of the Electron host. Keep it small and typed — every method here adds
 * attack surface (sandbox: false in BrowserWindow means the preload runs
 * with Node access; contextBridge is what keeps the renderer isolated).
 *
 * The shape consumed by:
 *   - lib/supabase/native-storage.ts → getStorageItem / setStorageItem / removeStorageItem
 *   - lib/platform.ts → window.electronAPI presence as the "is Electron?" sentinel
 *   - lib/hooks/useElectronUpdater.ts → updater methods + onUpdateStatus
 *   - lib/electric/storage/adapters/electron-sqlite-adapter.ts (future) → sqlite.*
 *   - src/main.tsx → rendererOta.notifyReady
 */

import { contextBridge, ipcRenderer } from 'electron';

async function safeInvoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  try {
    return await ipcRenderer.invoke(channel, ...args);
  } catch (err) {
    console.error(`[electron-ipc] ${channel} failed:`, err);
    throw err;
  }
}

const electronAPI = {
  // Platform info
  getVersion: (): Promise<string> => safeInvoke('app:version'),
  getPlatform: (): Promise<{ platform: string; arch: string; isDev: boolean }> =>
    safeInvoke('app:platform'),

  // Generic key-value storage backed by Electron safeStorage. Used by
  // lib/supabase/native-storage.ts as the auth session backing on Electron
  // (so sessions survive between launches, encrypted at rest).
  getStorageItem: (key: string): Promise<string | null> => safeInvoke('storage:get-item', key),
  setStorageItem: (key: string, value: string): Promise<void> =>
    safeInvoke('storage:set-item', key, value),
  removeStorageItem: (key: string): Promise<void> => safeInvoke('storage:remove-item', key),

  // Auto-updater (electron-updater). Calls reject if updater isn't wired up.
  checkForUpdates: (): Promise<{ success: boolean; error?: string }> =>
    safeInvoke('updater:check'),
  downloadUpdate: (): Promise<{ success: boolean; error?: string }> =>
    safeInvoke('updater:download'),
  installUpdate: (): Promise<void> => safeInvoke('updater:install'),
  getCurrentVersion: (): Promise<string> => safeInvoke('updater:current-version'),
  onUpdateStatus: (
    callback: (status: {
      status: string;
      info?: { version: string };
      error?: string;
      progress?: { percent: number };
    }) => void,
  ): (() => void) => {
    const handler = (_e: Electron.IpcRendererEvent, status: Parameters<typeof callback>[0]) =>
      callback(status);
    ipcRenderer.on('updater:status', handler);
    return () => ipcRenderer.removeListener('updater:status', handler);
  },

  // Renderer OTA.
  rendererOta: {
    /** Confirm a successful boot of the staged version. Called once after
     * React mounts in src/main.tsx. If notifyReady doesn't fire within the
     * boot window, the next launch rolls back to the previous active version. */
    notifyReady: (): void => ipcRenderer.send('renderer-ota:notify-ready'),
    checkNow: (): Promise<{ status: string; version?: string; error?: string }> =>
      safeInvoke('renderer-ota:check-now'),
    getStatus: (): Promise<{
      activeVersion: string | null;
      pendingVersion: string | null;
      lastCheck: string;
      shellVersion: string;
    }> => safeInvoke('renderer-ota:status'),
  },

  // Deep-link listener (myapp://… URLs)
  onDeepLink: (callback: (url: string) => void): (() => void) => {
    const handler = (_e: Electron.IpcRendererEvent, url: string) => callback(url);
    ipcRenderer.on('app:deep-link', handler);
    return () => ipcRenderer.removeListener('app:deep-link', handler);
  },
};

contextBridge.exposeInMainWorld('electronAPI', electronAPI);

export type ElectronAPI = typeof electronAPI;
