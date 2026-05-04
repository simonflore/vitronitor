import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import '../app/globals.css';

// On Capacitor native, tell @capgo/capacitor-updater that the bundle finished
// loading without crashing. Without this call within `appReadyTimeout` (15s
// in capacitor.config.ts), the next launch rolls back to the previous bundle.
//
// Called BEFORE React mount on purpose — a lazy-chunk import error would
// prevent the app from rendering, but as long as the bundle's main script
// executed we still want to mark the bundle "good".
async function notifyOtaReady() {
  if (typeof window === 'undefined') return;
  const isCapacitor = (window as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.();
  if (!isCapacitor) return;
  try {
    const { CapacitorUpdater } = await import('@capgo/capacitor-updater');
    await CapacitorUpdater.notifyAppReady();
  } catch {
    // First boot before the plugin is registered; safe to ignore.
  }
}
notifyOtaReady();

const root = document.getElementById('root');
if (!root) throw new Error('#root not found');

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
