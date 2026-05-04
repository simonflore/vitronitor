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
 * pipelines instead (M6 / M9).
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
      })
      .catch((e) => {
        console.warn('[sw] registration failed:', e);
      });

    // Reload once when the new SW takes control (after applyUpdate).
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloaded) return;
      reloaded = true;
      window.location.reload();
    });

    return () => {
      cancelled = true;
    };
  }, []);

  function applyUpdate() {
    if (!registration?.waiting) return;
    registration.waiting.postMessage('SKIP_WAITING');
  }

  return { isReady, hasUpdate, applyUpdate };
}
