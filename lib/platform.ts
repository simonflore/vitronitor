/**
 * Runtime platform detection.
 *
 * Used by code that needs to branch on host runtime (e.g. swap auth storage,
 * pick a Network source, choose between IndexedDB and SQLite).
 *
 * Detection rules:
 *   - Capacitor: window.Capacitor?.isNativePlatform() === true
 *   - Electron:  window.electronAPI exists (set by electron/main/preload.ts)
 *   - Web:       neither of the above
 */

interface CapacitorWindow {
  Capacitor?: { isNativePlatform?: () => boolean; getPlatform?: () => 'web' | 'ios' | 'android' };
}

interface ElectronWindow {
  electronAPI?: unknown;
}

export function isCapacitorPlatform(): boolean {
  if (typeof window === 'undefined') return false;
  return (window as unknown as CapacitorWindow).Capacitor?.isNativePlatform?.() === true;
}

export function isElectronPlatform(): boolean {
  if (typeof window === 'undefined') return false;
  return !!(window as unknown as ElectronWindow).electronAPI;
}

export function isWebPlatform(): boolean {
  return !isCapacitorPlatform() && !isElectronPlatform();
}

export function getCapacitorPlatform(): 'web' | 'ios' | 'android' {
  if (typeof window === 'undefined') return 'web';
  return ((window as unknown as CapacitorWindow).Capacitor?.getPlatform?.() ?? 'web') as
    | 'web'
    | 'ios'
    | 'android';
}
