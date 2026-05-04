import { useNetwork } from '@/lib/contexts/NetworkContext';
import { useServiceWorker } from '@/lib/hooks/useServiceWorker';

/**
 * Persistent banner for two states:
 *   - offline   — yellow indicator
 *   - update available — blue indicator + apply button
 *
 * Mounted in App.tsx so it appears on every page.
 */
export function OfflineBanner() {
  const { isOnline } = useNetwork();
  const { hasUpdate, applyUpdate } = useServiceWorker();

  if (!isOnline) {
    return (
      <div className="bg-amber-900/40 px-4 py-1.5 text-center text-xs text-amber-100">
        You&apos;re offline — changes will sync when you reconnect.
      </div>
    );
  }

  if (hasUpdate) {
    return (
      <div className="flex items-center justify-center gap-3 bg-indigo-900/40 px-4 py-1.5 text-xs text-indigo-100">
        <span>A new version of Vitronitor is available.</span>
        <button
          onClick={applyUpdate}
          className="rounded bg-indigo-500 px-2 py-0.5 font-medium text-white hover:bg-indigo-400"
        >
          Reload
        </button>
      </div>
    );
  }

  return null;
}
