/**
 * Electron renderer OTA endpoint.
 *
 * Mirrors /api/capacitor/bundle (iOS Capgo) but for Electron renderer bundles.
 * The Electron renderer-OTA module (electron/main/renderer-ota.ts) POSTs
 * here on boot + every hour with its current version. We respond with a
 * newer signed bundle if one exists, or {} if up-to-date.
 *
 * Bundles are RSA-signed with the same .capgo_key_v2 used for iOS, so the
 * Electron renderer verifies bundles using the same public PEM. That key
 * lives in electron/main/renderer-ota.ts as PUBLIC_KEY_PEM.
 *
 * Extra field vs Capgo: `min_native_version` — refuses to apply a renderer
 * bundle that requires a newer Electron shell than the user is running. The
 * publish script writes this from package.json.electron.minRendererNativeVersion
 * (or falls back to package.json.version).
 *
 * Manifest layout on S3:
 *   <bucket>/electron/bundle/manifest.json
 *   <bucket>/electron/bundle/<version>/bundle.zip
 */

import { Hono } from 'hono';
import { z } from 'zod';
import semver from 'semver';
import { createPresignedGetUrl } from '../../lib/object-storage';

const updateCheckSchema = z
  .object({
    version_name: z.string().optional(),
    version_build: z.string().optional(),
    native_version: z.string().optional(),
    platform: z.string().optional(),
  })
  .passthrough();

const RELEASES_BUCKET = process.env.S3_RELEASES_BUCKET || 'releases';
const MANIFEST_KEY = 'electron/bundle/manifest.json';
const MANIFEST_CACHE_TTL = 60 * 1000;

interface RendererManifest {
  version: string;
  checksum: string;
  sessionKey: string;
  date: string;
  key: string;
  min_native_version: string;
}

let cached: { data: RendererManifest; ts: number } | null = null;

async function getManifest(): Promise<RendererManifest | null> {
  if (cached && Date.now() - cached.ts < MANIFEST_CACHE_TTL) return cached.data;
  try {
    const url = await createPresignedGetUrl(RELEASES_BUCKET, MANIFEST_KEY, 300);
    const res = await fetch(url);
    if (!res.ok) {
      console.warn(`[renderer-ota] manifest fetch failed: HTTP ${res.status}`);
      return null;
    }
    const data = (await res.json()) as RendererManifest;
    if (
      !data.version ||
      !data.checksum ||
      !data.sessionKey ||
      !data.key ||
      !data.min_native_version
    ) {
      console.error('[renderer-ota] manifest missing required fields');
      return null;
    }
    cached = { data, ts: Date.now() };
    return data;
  } catch (err) {
    console.error('[renderer-ota] manifest fetch error:', err);
    return null;
  }
}

const app = new Hono();

app.post('/', async (c) => {
  try {
    const body = await c.req.json();
    const parsed = updateCheckSchema.safeParse(body);
    if (!parsed.success) return c.json({});

    const versionName = parsed.data.version_name;
    const versionBuild = parsed.data.version_build;
    const nativeVersion = parsed.data.native_version;
    const deviceVersion = versionName && versionName !== 'builtin' ? versionName : versionBuild;
    if (!deviceVersion) return c.json({});

    const manifest = await getManifest();
    if (!manifest) return c.json({});

    // Native shell floor — refuse if the device's electron-builder shell is
    // older than what the renderer bundle requires.
    if (nativeVersion) {
      const native = semver.valid(semver.coerce(nativeVersion));
      const required = semver.valid(semver.coerce(manifest.min_native_version));
      if (native && required && semver.lt(native, required)) {
        console.log(
          `[renderer-ota] device shell ${nativeVersion} < required ${manifest.min_native_version} — withholding`,
        );
        return c.json({});
      }
    }

    const m = semver.valid(semver.coerce(manifest.version));
    const d = semver.valid(semver.coerce(deviceVersion));
    if (!m || !d || !semver.gt(m, d)) return c.json({});

    const url = await createPresignedGetUrl(RELEASES_BUCKET, manifest.key, 3600);

    return c.json({
      version: manifest.version,
      url,
      checksum: manifest.checksum,
      session_key: manifest.sessionKey,
      min_native_version: manifest.min_native_version,
    });
  } catch (err) {
    console.error('[renderer-ota] update check failed:', err);
    return c.json({});
  }
});

export default app;
