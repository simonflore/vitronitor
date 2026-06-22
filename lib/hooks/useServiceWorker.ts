/**
 * Service worker registration + update detection.
 *
 * Returns:
 *   - isReady       — true once the SW is registered
 *   - hasUpdate     — true when a new SW version is waiting to activate
 *   - applyUpdate   — call to skipWaiting + reload (user-initiated)
 *
 * On native (Capacitor/Electron) the SW is not installed — registration is
 * a no-op there. Native gets its updates via the Capgo / renderer-OTA
 * pipelines instead.
 */

import { useEffect, useState } from 'react';

const isNative = (): boolean => {
  if (typeof window === 'undefined') return false;
  const o = window.location.origin;
  return o.startsWith('capacitor://') || o.startsWith('file://');
};

export function useServiceWorker() {
  const [isReady, setIsReady] = useState(false);
  const [hasUpdate, setHasUpdate] = useState(false);
  const [registration, setRegistration] = useState<ServiceWorkerRegistration | null>(null);

  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
    if (isNative()) return;

    let cancelled = false;
    let onVisibilityChange: (() => void) | null = null;

    navigator.serviceWorker
      .register('/sw.js')
      .then((reg) => {
        if (cancelled) return;
        setRegistration(reg);
        setIsReady(true);

        // Detect a new SW that's installed and waiting.
        if (reg.waiting) setHasUpdate(true);

        reg.addEventListener('updatefound', () => {
          const newSw = reg.installing;
          if (!newSw) return;
          newSw.addEventListener('statechange', () => {
            if (newSw.state === 'installed' && navigator.serviceWorker.controller) {
              setHasUpdate(true);
            }
          });
        });

        // Installed PWAs / long-open tabs rarely navigate, so the browser's own
        // SW update check seldom runs. Re-check whenever the app regains focus
        // so a deploy made while it was backgrounded is picked up on return
        // (→ a new waiting SW → hasUpdate, or controllerchange → reload below).
        onVisibilityChange = () => {
          if (document.visibilityState === 'visible') {
            reg.update().catch(() => {});
          }
        };
        document.addEventListener('visibilitychange', onVisibilityChange);
      })
      .catch((e) => {
        console.warn('[sw] registration failed:', e);
      });

    // Reload once when a new SW takes control. `hadController` is false on a
    // true first visit — the initial activate → clients.claim() fires
    // `controllerchange` once, and we must NOT reload then (the page already
    // runs the latest JS). On any later visit an updated SW that calls
    // skipWaiting() + clients.claim() (after applyUpdate, or a focus-triggered
    // update that auto-activates) fires it again, which is our cue to refresh.
    const hadController = !!navigator.serviceWorker.controller;
    let reloaded = false;
    const onControllerChange = () => {
      if (!hadController || reloaded) return;
      reloaded = true;
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);

    return () => {
      cancelled = true;
      navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
      if (onVisibilityChange) document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, []);

  function applyUpdate() {
    if (!registration?.waiting) return;
    registration.waiting.postMessage('SKIP_WAITING');
  }

  return { isReady, hasUpdate, applyUpdate };
}
