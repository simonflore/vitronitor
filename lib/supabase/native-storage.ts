/**
 * Native auth storage adapter for Supabase.
 *
 * Web: Supabase uses localStorage by default — fine.
 * Capacitor: WebView storage gets evicted aggressively on iOS/Android. We
 *   back the auth session with @capacitor/preferences (UserDefaults / Shared
 *   Prefs) which survives WebView eviction.
 * Electron: backed by safeStorage via IPC — same interface.
 *
 * The adapter conforms to the @supabase/supabase-js GoTrueClient storage
 * interface: { getItem, setItem, removeItem }. `createClient()` in
 * lib/supabase/client.ts picks this on native, the default on web.
 */

import { isCapacitorPlatform, isElectronPlatform } from '@/lib/platform';

interface SupportedStorage {
  getItem: (key: string) => string | null | Promise<string | null>;
  setItem: (key: string, value: string) => void | Promise<void>;
  removeItem: (key: string) => void | Promise<void>;
}

class CapacitorPreferencesStorage implements SupportedStorage {
  async getItem(key: string): Promise<string | null> {
    const { Preferences } = await import('@capacitor/preferences');
    const { value } = await Preferences.get({ key });
    return value;
  }
  async setItem(key: string, value: string): Promise<void> {
    const { Preferences } = await import('@capacitor/preferences');
    await Preferences.set({ key, value });
  }
  async removeItem(key: string): Promise<void> {
    const { Preferences } = await import('@capacitor/preferences');
    await Preferences.remove({ key });
  }
}

interface ElectronStorageAPI {
  getStorageItem?: (key: string) => Promise<string | null>;
  setStorageItem?: (key: string, value: string) => Promise<void>;
  removeStorageItem?: (key: string) => Promise<void>;
}

class ElectronIpcStorage implements SupportedStorage {
  private get api(): ElectronStorageAPI | null {
    if (typeof window === 'undefined') return null;
    return (window as unknown as { electronAPI?: ElectronStorageAPI }).electronAPI ?? null;
  }
  async getItem(key: string): Promise<string | null> {
    return (await this.api?.getStorageItem?.(key)) ?? null;
  }
  async setItem(key: string, value: string): Promise<void> {
    await this.api?.setStorageItem?.(key, value);
  }
  async removeItem(key: string): Promise<void> {
    await this.api?.removeStorageItem?.(key);
  }
}

/**
 * Returns the right storage adapter for the current platform, or `undefined`
 * to let Supabase fall back to localStorage (web).
 */
export function getNativeAuthStorage(): SupportedStorage | undefined {
  if (isCapacitorPlatform()) return new CapacitorPreferencesStorage();
  if (isElectronPlatform()) return new ElectronIpcStorage();
  return undefined;
}
