/**
 * Electron auto-updater feed proxy.
 *
 * electron-updater's "generic" provider hits this endpoint for both the
 * manifest (latest-mac.yml / latest.yml / latest-linux.yml) and the binary
 * download (.dmg / .zip / .exe / .AppImage / .blockmap).
 *
 *   - YAML / JSON manifests are returned inline with strict no-cache headers
 *     so a cached `latest-*.yml` can never make installed apps think
 *     "no update available" indefinitely.
 *   - Binaries are 302-redirected to a presigned S3 GET URL (1h TTL) so the
 *     bytes never traverse the API server.
 *
 * S3 layout (bucket = $S3_RELEASES_BUCKET, default "releases"):
 *   electron/shell/latest-mac.yml
 *   electron/shell/latest-linux.yml
 *   electron/shell/latest.yml                                ← Windows manifest name
 *   electron/shell/<ProductName>-<version>-arm64.dmg
 *   electron/shell/<ProductName>-<version>-arm64-mac.zip
 *   electron/shell/<ProductName>-<version>-arm64.dmg.blockmap
 *   electron/shell/<ProductName> Setup <version>.exe
 *   electron/shell/<ProductName>-<version>.AppImage
 */

import { Hono } from 'hono';
import { createPresignedGetUrl } from '../../lib/object-storage';

const RELEASES_BUCKET = process.env.S3_RELEASES_BUCKET || 'releases';
const RELEASES_PREFIX = 'electron/shell';
const ALLOWED_EXTENSIONS = ['.yml', '.dmg', '.zip', '.exe', '.AppImage', '.json', '.blockmap'] as const;

const app = new Hono();

// GET /api/electron/shell/* — both manifests and binaries
app.get('/*', async (c) => {
  const filename = c.req.path.replace(/^.*\/releases\//, '');

  // Path traversal / weird input → 400
  if (!filename || filename.includes('..') || filename.includes('//')) {
    return c.json({ error: 'Invalid path' }, 400);
  }
  if (!ALLOWED_EXTENSIONS.some((e) => filename.endsWith(e))) {
    return c.json({ error: 'Not found' }, 404);
  }

  const key = `${RELEASES_PREFIX}/${filename}`;

  try {
    if (filename.endsWith('.yml') || filename.endsWith('.json')) {
      // Inline manifest. Re-fetch from S3 each request — manifests are small.
      const presigned = await createPresignedGetUrl(RELEASES_BUCKET, key, 300);
      const res = await fetch(presigned);
      if (!res.ok) return c.json({ error: 'Not found' }, 404);
      const body = await res.text();
      c.header('Content-Type', filename.endsWith('.json') ? 'application/json' : 'text/yaml');
      c.header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
      c.header('Pragma', 'no-cache');
      return c.body(body);
    }

    // Binary → presigned redirect.
    const presigned = await createPresignedGetUrl(RELEASES_BUCKET, key, 3600);
    return c.redirect(presigned);
  } catch (err) {
    console.error(`[releases] failed to serve ${key}:`, err);
    return c.json({ error: 'Not found' }, 404);
  }
});

export default app;
