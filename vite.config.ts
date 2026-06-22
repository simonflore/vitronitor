import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';

/**
 * Append a unique per-build suffix to the service worker's CACHE_NAME so the
 * deployed sw.js differs byte-for-byte on every build.
 *
 * The `prebuild` hook (scripts/sync-version.js) only rewrites CACHE_NAME when
 * the package version changes — and a Docker/CI build that runs `vite build`
 * directly bypasses it entirely. In both cases the committed CACHE_NAME would
 * ship unchanged, the browser never detects an SW update, the activate handler
 * never purges old caches, and clients keep running stale JS.
 *
 * Pairs with the `controllerchange` reload in useServiceWorker: a changed
 * CACHE_NAME → install → (skipWaiting) → clients.claim → page reloads onto the
 * fresh bundle. Stamps only dist/sw.js; the source public/sw.js is untouched.
 */
function stampServiceWorker(): Plugin {
  const buildId = Date.now().toString(36);
  return {
    name: 'stamp-service-worker',
    apply: 'build',
    closeBundle() {
      const swPath = path.resolve(__dirname, 'dist/sw.js');
      if (!existsSync(swPath)) return;
      const sw = readFileSync(swPath, 'utf-8');
      const stamped = sw.replace(
        /const CACHE_NAME = '([^']+)'/,
        `const CACHE_NAME = '$1-build.${buildId}'`,
      );
      if (stamped !== sw) writeFileSync(swPath, stamped);
    },
  };
}

export default defineConfig({
  plugins: [react(), stampServiceWorker()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: 'hidden',
    assetsDir: 'assets',
  },
  // Relative base so file:// resolves assets correctly when packaged into Electron.
  base: './',
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3001',
    },
  },
  envPrefix: 'VITE_',
});
