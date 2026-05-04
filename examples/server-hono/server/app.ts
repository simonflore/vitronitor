import { Hono } from 'hono';
import { serveStatic } from '@hono/node-server/serve-static';
import { securityHeaders } from './middleware/security-headers';
import { notFoundResponse } from './lib/response';
import healthRoutes from './routes/health';
import notesRoutes from './routes/notes';
import electricRoutes from './routes/electric';
import capacitorBundleRoutes from './routes/capacitor-bundle';
import electronShellRoutes from './routes/electron-shell';
import electronBundleRoutes from './routes/electron-bundle';

export const app = new Hono();

app.use('*', securityHeaders);

// API routes — mount under /api so Caddy/Vite proxy them cleanly in dev.
app.route('/api/health', healthRoutes);
app.route('/api/notes', notesRoutes);
app.route('/api/electric', electricRoutes);
app.route('/api/capacitor/bundle', capacitorBundleRoutes);            // iOS Capgo OTA
app.route('/api/electron/shell', electronShellRoutes);                 // Electron shell auto-updater
app.route('/api/electron/bundle', electronBundleRoutes); // Electron renderer OTA

// 404 for unmatched /api/* paths so they don't fall through to the SPA fallback below.
app.all('/api/*', (c) => notFoundResponse(c, 'Endpoint'));

// In production the same Hono process serves the built SPA from dist/.
// In dev Vite serves the SPA on :5173, so this is unreachable (Caddy/Vite
// owns non-/api routing).
if (process.env.NODE_ENV === 'production') {
  app.use('/*', serveStatic({ root: './dist' }));
  // SPA fallback — hash routing means index.html is the only entry the SPA needs.
  app.get('*', serveStatic({ path: './dist/index.html' }));
}
