import { useEffect } from 'react';
import { useCapacitorUpdater } from '@/lib/hooks/useCapacitorUpdater';

/**
 * Manual OTA controls for testing. Mounted at /dev/update-debug.
 *
 * Useful checks during OTA pipeline setup:
 *   - "Check" hits POST /api/capacitor/bundle and shows the response
 *   - "Download" verifies the signed bundle (refuses on bad signature)
 *   - "Install" swaps the bundle and reloads the WebView
 *   - "Bundles" lists what's already on disk; useful when verifying that
 *     auto-cleanup of old versions works
 */
export function UpdateDebugPanel() {
  const u = useCapacitorUpdater();

  useEffect(() => {
    if (u.isNative) {
      u.checkForUpdates();
      u.listBundles();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!u.isNative) {
    return (
      <div className="rounded-lg border border-zinc-800 p-4 text-sm">
        <p className="text-zinc-400">
          OTA updates run only on Capacitor native builds (iOS/Android).
        </p>
        <p className="mt-2 text-xs text-zinc-600">
          Build a native app via <code>npm run cap:sync</code> + Xcode/Android Studio to test.
        </p>
      </div>
    );
  }

  const { state, checkForUpdates, downloadUpdate, installUpdate, listBundles, deleteBundle } = u;

  return (
    <div className="space-y-4">
      <section className="rounded-lg border border-zinc-800 p-4 text-sm">
        <h2 className="text-xs font-medium uppercase tracking-wider text-zinc-500">Status</h2>
        <dl className="mt-2 space-y-1">
          <div className="flex justify-between">
            <dt className="text-zinc-500">State</dt>
            <dd>{state.status}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-zinc-500">Current</dt>
            <dd>{state.currentVersion || '—'}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-zinc-500">Available</dt>
            <dd>{state.availableVersion ?? 'no update'}</dd>
          </div>
          {state.status === 'downloading' && (
            <div className="flex justify-between">
              <dt className="text-zinc-500">Progress</dt>
              <dd>{Math.round(state.downloadProgress)}%</dd>
            </div>
          )}
          {state.error && <p className="text-red-400">Error: {state.error}</p>}
        </dl>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            onClick={() => checkForUpdates()}
            className="rounded-md bg-indigo-500 px-3 py-1 text-xs font-medium text-white hover:bg-indigo-400"
          >
            Check
          </button>
          <button
            disabled={!state.availableVersion}
            onClick={() => state.availableVersion && downloadUpdate({ version: state.availableVersion, url: '' })}
            className="rounded-md bg-zinc-800 px-3 py-1 text-xs font-medium hover:bg-zinc-700 disabled:opacity-50"
          >
            Download
          </button>
        </div>
      </section>

      <section className="rounded-lg border border-zinc-800 p-4 text-sm">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-medium uppercase tracking-wider text-zinc-500">
            Bundles ({state.bundles.length})
          </h2>
          <button
            onClick={() => listBundles()}
            className="text-xs text-indigo-400 hover:underline"
          >
            Refresh
          </button>
        </div>
        {state.bundles.length === 0 && <p className="mt-2 text-xs text-zinc-500">No bundles downloaded.</p>}
        {state.bundles.length > 0 && (
          <ul className="mt-2 divide-y divide-zinc-800">
            {state.bundles.map((b) => (
              <li key={b.id} className="flex items-center justify-between py-2">
                <div>
                  <div className="font-mono text-xs">{b.version}</div>
                  <div className="text-xs text-zinc-600">{b.id}</div>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => installUpdate(b)}
                    className="rounded bg-indigo-500 px-2 py-0.5 text-xs text-white hover:bg-indigo-400"
                  >
                    Install
                  </button>
                  <button
                    onClick={() => deleteBundle(b.id)}
                    className="rounded bg-zinc-800 px-2 py-0.5 text-xs hover:bg-zinc-700"
                  >
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
