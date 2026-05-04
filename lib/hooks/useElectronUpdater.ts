/**
 * React hook for the Electron auto-updater.
 *
 * Subscribes to updater:status events from the main process and exposes
 * the {check, download, install} actions. No-op on non-Electron platforms.
 *
 * Used by components/admin/UpdateDebugPanel.tsx — the same /dev/update-debug
 * route shows OTA status for whichever native platform is hosting the app.
 */

import { useCallback, useEffect, useState } from 'react';
import { isElectronPlatform } from '@/lib/platform';

export interface ElectronUpdateStatus {
  status: 'idle' | 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error';
  version: string | null;
  currentVersion: string | null;
  progress: number;
  error: string | null;
}

export function useElectronUpdater() {
  const isElectron = isElectronPlatform();
  const [state, setState] = useState<ElectronUpdateStatus>({
    status: 'idle',
    version: null,
    currentVersion: null,
    progress: 0,
    error: null,
  });

  useEffect(() => {
    if (!isElectron) return;
    const api = window.electronAPI!;
    api.getCurrentVersion().then((v) => setState((s) => ({ ...s, currentVersion: v })));

    const unsubscribe = api.onUpdateStatus((status) => {
      setState((s) => ({
        ...s,
        status: status.status as ElectronUpdateStatus['status'],
        version: status.info?.version ?? s.version,
        progress: status.progress?.percent ?? s.progress,
        error: status.error ?? null,
      }));
    });
    return unsubscribe;
  }, [isElectron]);

  const checkForUpdates = useCallback(async () => {
    if (!isElectron) return null;
    return window.electronAPI!.checkForUpdates();
  }, [isElectron]);

  const downloadUpdate = useCallback(async () => {
    if (!isElectron) return null;
    return window.electronAPI!.downloadUpdate();
  }, [isElectron]);

  const installUpdate = useCallback(async () => {
    if (!isElectron) return;
    await window.electronAPI!.installUpdate();
  }, [isElectron]);

  return { state, isElectron, checkForUpdates, downloadUpdate, installUpdate };
}
