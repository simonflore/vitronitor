/**
 * React hook around @capgo/capacitor-updater.
 *
 * No-op on web/Electron. On Capacitor native:
 *   - checkForUpdates()  — POSTs to /api/capacitor/bundle, returns the manifest if newer
 *   - downloadUpdate()   — fetches + verifies the signed bundle; reports progress
 *   - installUpdate()    — swaps the running bundle (reloads the WebView)
 *   - listBundles()      — enumerates downloaded bundles
 *   - deleteBundle()     — removes a downloaded bundle
 *
 * Used by components/admin/UpdateDebugPanel.tsx (route /dev/update-debug).
 */

import { useState, useCallback } from 'react';
import { isCapacitorPlatform } from '@/lib/platform';
import type {
  BundleInfo,
  BundleListResult,
  DownloadOptions,
  LatestVersion,
} from '@capgo/capacitor-updater';

export interface UpdateState {
  status: 'idle' | 'checking' | 'downloading' | 'installing' | 'error';
  currentVersion: string;
  availableVersion: string | null;
  downloadProgress: number;
  error: string | null;
  bundles: BundleInfo[];
}

export function useCapacitorUpdater() {
  const [state, setState] = useState<UpdateState>({
    status: 'idle',
    currentVersion: '',
    availableVersion: null,
    downloadProgress: 0,
    error: null,
    bundles: [],
  });

  const isNative = isCapacitorPlatform();

  const checkForUpdates = useCallback(async () => {
    if (!isNative) {
      setState((s) => ({ ...s, error: 'OTA only runs on Capacitor native builds' }));
      return null;
    }
    setState((s) => ({ ...s, status: 'checking', error: null }));
    try {
      const { CapacitorUpdater } = await import('@capgo/capacitor-updater');
      const current = await CapacitorUpdater.current();
      const latest: LatestVersion = await CapacitorUpdater.getLatest();
      setState((s) => ({
        ...s,
        status: 'idle',
        currentVersion: current.bundle.version,
        availableVersion: latest.version || null,
      }));
      return latest;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'check failed';
      setState((s) => ({ ...s, status: 'error', error: msg }));
      return null;
    }
  }, [isNative]);

  const downloadUpdate = useCallback(
    async (options: DownloadOptions) => {
      if (!isNative) return null;
      setState((s) => ({ ...s, status: 'downloading', error: null, downloadProgress: 0 }));
      try {
        const { CapacitorUpdater } = await import('@capgo/capacitor-updater');
        await CapacitorUpdater.addListener('download', (info: { percent: number }) => {
          setState((s) => ({ ...s, downloadProgress: info.percent }));
        });
        const version = await CapacitorUpdater.download(options);
        setState((s) => ({ ...s, status: 'idle', downloadProgress: 100 }));
        await CapacitorUpdater.removeAllListeners();
        return version;
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'download failed';
        setState((s) => ({ ...s, status: 'error', error: msg }));
        try {
          const { CapacitorUpdater } = await import('@capgo/capacitor-updater');
          await CapacitorUpdater.removeAllListeners();
        } catch {
          /* best-effort */
        }
        return null;
      }
    },
    [isNative],
  );

  const installUpdate = useCallback(
    async (version: BundleInfo) => {
      if (!isNative) return false;
      setState((s) => ({ ...s, status: 'installing', error: null }));
      try {
        const { CapacitorUpdater } = await import('@capgo/capacitor-updater');
        await CapacitorUpdater.set(version); // reloads the WebView
        return true;
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'install failed';
        setState((s) => ({ ...s, status: 'error', error: msg }));
        return false;
      }
    },
    [isNative],
  );

  const listBundles = useCallback(async () => {
    if (!isNative) return [];
    try {
      const { CapacitorUpdater } = await import('@capgo/capacitor-updater');
      const result: BundleListResult = await CapacitorUpdater.list();
      setState((s) => ({ ...s, bundles: result.bundles }));
      return result.bundles;
    } catch {
      return [];
    }
  }, [isNative]);

  const deleteBundle = useCallback(
    async (bundleId: string) => {
      if (!isNative) return false;
      try {
        const { CapacitorUpdater } = await import('@capgo/capacitor-updater');
        await CapacitorUpdater.delete({ id: bundleId });
        await listBundles();
        return true;
      } catch {
        return false;
      }
    },
    [isNative, listBundles],
  );

  return { state, isNative, checkForUpdates, downloadUpdate, installUpdate, listBundles, deleteBundle };
}
