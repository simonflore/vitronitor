/**
 * Network status context.
 *
 * Sources, in order of preference:
 *   - Capacitor Network plugin (more reliable on iOS/Android than navigator.onLine,
 *     which lies on cellular ↔ wifi switches and during airplane mode toggles)
 *   - browser `online`/`offline` events (web + Electron)
 *
 * Both sources are subscribed simultaneously when both are available — the
 * latest event wins, so a connection drop is reflected by whichever fires first.
 */

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { isCapacitorPlatform } from '@/lib/platform';

interface NetworkContextValue {
  isOnline: boolean;
}

const NetworkContext = createContext<NetworkContextValue | null>(null);

export function NetworkProvider({ children }: { children: ReactNode }) {
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true,
  );

  useEffect(() => {
    const onOnline = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);

    // Capacitor Network listener — only loads on native (avoids dragging the
    // plugin into web bundles).
    let removeCap: (() => void) | undefined;
    if (isCapacitorPlatform()) {
      (async () => {
        try {
          const { Network } = await import('@capacitor/network');
          const status = await Network.getStatus();
          setIsOnline(status.connected);
          const handle = await Network.addListener('networkStatusChange', (s) => {
            setIsOnline(s.connected);
          });
          removeCap = () => handle.remove();
        } catch (e) {
          console.warn('[network] capacitor plugin unavailable:', e);
        }
      })();
    }

    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      removeCap?.();
    };
  }, []);

  return <NetworkContext.Provider value={{ isOnline }}>{children}</NetworkContext.Provider>;
}

export function useNetwork() {
  const ctx = useContext(NetworkContext);
  if (!ctx) throw new Error('useNetwork must be used within NetworkProvider');
  return ctx;
}
