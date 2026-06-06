// This constant is kept in sync with package.json "version" by
// `scripts/sync-version.js`, which runs as the npm prebuild script.
// Edit package.json, not this file.
export const APP_VERSION = '0.1.0';

/**
 * Manual recovery from a stuck OTA bundle or a wedged Service Worker:
 * unregister all SWs, drop every Cache Storage entry, clear web storage
 * (preserving Supabase auth so the user stays signed in), then hard-reload
 * from the server. Wire this to a "Force update" / "Reset app" affordance —
 * it's the escape hatch when a bad cached shell won't update on its own.
 */
export async function forceUpdate(): Promise<void> {
  if ('serviceWorker' in navigator) {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map((reg) => reg.unregister()));
  }

  if ('caches' in window) {
    const cacheNames = await caches.keys();
    await Promise.all(cacheNames.map((name) => caches.delete(name)));
  }

  // Preserve Supabase auth keys (sb-*, supabase*) so the reload stays signed in.
  const authPrefixes = ['sb-', 'supabase'];
  const preserved: Array<{ key: string; value: string }> = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && authPrefixes.some((p) => key.startsWith(p))) {
      const value = localStorage.getItem(key);
      if (value !== null) preserved.push({ key, value });
    }
  }
  localStorage.clear();
  preserved.forEach(({ key, value }) => localStorage.setItem(key, value));

  window.location.reload();
}
