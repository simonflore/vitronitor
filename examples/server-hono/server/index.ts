// Hono API server entry point.
// Dev: port 3001 (Vite proxies /api/*, Caddy fronts both at https://localhost:3000).
// Prod: serves API + static SPA from dist/.

import { config } from 'dotenv';

// .env.local takes precedence over .env (Vite ordering).
config({ path: '.env.local' });
config({ path: '.env' });

import { validateEnv } from './lib/env';
validateEnv();

import { serve } from '@hono/node-server';
import { app } from './app';

const port = parseInt(process.env.PORT || '3001', 10);

console.log(`[vitronitor] server listening on http://localhost:${port}`);

serve({
  fetch: app.fetch,
  port,
});
