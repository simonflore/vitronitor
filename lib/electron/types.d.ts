/**
 * TypeScript types for the renderer-side window.electronAPI surface.
 *
 * The shape mirrors electron/main/preload.ts. Hand-maintained because
 * the preload runs in a separate tsconfig (electron/tsconfig.json) — the
 * renderer compile doesn't see those exports.
 */

declare global {
  interface Window {
    electronAPI?: {
      // Platform info
      getVersion: () => Promise<string>;
      getPlatform: () => Promise<{ platform: string; arch: string; isDev: boolean }>;

      // Encrypted KV storage (Supabase auth backing)
      getStorageItem: (key: string) => Promise<string | null>;
      setStorageItem: (key: string, value: string) => Promise<void>;
      removeStorageItem: (key: string) => Promise<void>;

      // Auto-updater
      checkForUpdates: () => Promise<{ success: boolean; error?: string }>;
      downloadUpdate: () => Promise<{ success: boolean; error?: string }>;
      installUpdate: () => Promise<void>;
      getCurrentVersion: () => Promise<string>;
      onUpdateStatus: (
        cb: (status: {
          status: string;
          info?: { version: string };
          error?: string;
          progress?: { percent: number };
        }) => void,
      ) => () => void;

      // Renderer OTA
      rendererOta: {
        notifyReady: () => void;
        checkNow: () => Promise<{ status: string; version?: string; error?: string }>;
        getStatus: () => Promise<{
          activeVersion: string | null;
          pendingVersion: string | null;
          lastCheck: string;
          shellVersion: string;
        }>;
      };

      // Deep links (myapp://…)
      onDeepLink: (cb: (url: string) => void) => () => void;
    };
  }
}

export {};
