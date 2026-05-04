/**
 * Capacitor OTA update endpoint (iOS).
 *
 * The @capgo/capacitor-updater plugin POSTs device info here on launch (and
 * periodically). We respond with { version, url, checksum, session_key } if
 * a newer signed bundle exists, or {} if the device is already current.
 *
 * Public endpoint — no auth required. Security comes from RSA-signed bundles:
 * the device verifies the signature using the public key embedded in
 * capacitor.config.ts. Even if the object store is compromised, attackers
 * can't forge a bundle without the private signing key.
 *
 * Manifest layout on S3:
 *   <bucket>/capacitor/bundle/manifest.json     ← {version, checksum, sessionKey, key, date}
 *   <bucket>/capacitor/bundle/<version>/bundle.zip
 */

import { Hono } from 'hono';
import { z } from 'zod';
import semver from 'semver';
import { createPresignedGetUrl } from '../../lib/object-storage';

const updateCheckSchema = z
  .object({
    version_name: z.string().optional(),
    version_build: z.string().optional(),
    platform: z.string().optional(),
    plugin_version: z.string().optional(),
    app_id: z.string().optional(),
    device_id: z.string().optional(),
    custom_id: z.string().optional(),
    is_emulator: z.boolean().optional(),
    is_prod: z.boolean().optional(),
    version_os: z.string().optional(),
  })
  .passthrough();

// TODO(boilerplate): change "releases" if your bucket is named differently.
const RELEASES_BUCKET = process.env.S3_RELEASES_BUCKET || 'releases';
const MANIFEST_KEY = 'capacitor/bundle/manifest.json';
const MANIFEST_CACHE_TTL = 60 * 1000; // 1 minute

interface CapacitorManifest {
  version: string;
  checksum: string;     // RSA-signed checksum
  sessionKey: string;   // RSA-encrypted AES session key
  date: string;
  key: string;          // S3 key for the bundle, e.g. "capacitor/bundle/3.1.0/bundle.zip"
}

let cached: { data: CapacitorManifest; ts: number } | null = null;

async function getManifest(): Promise<CapacitorManifest | null> {
  if (cached && Date.now() - cached.ts < MANIFEST_CACHE_TTL) return cached.data;
  try {
    const url = await createPresignedGetUrl(RELEASES_BUCKET, MANIFEST_KEY, 300);
    const res = await fetch(url);
    if (!res.ok) {
      console.warn(`[ota] manifest fetch failed: HTTP ${res.status}`);
      return null;
    }
    const data = (await res.json()) as CapacitorManifest;
    if (!data.version || !data.checksum || !data.sessionKey || !data.key) {
      console.error('[ota] manifest missing required fields');
      return null;
    }
    cached = { data, ts: Date.now() };
    return data;
  } catch (err) {
    console.error('[ota] manifest fetch error:', err);
    return null;
  }
}

const app = new Hono();

app.post('/', async (c) => {
  try {
    const body = await c.req.json();
    const parsed = updateCheckSchema.safeParse(body);
    if (!parsed.success) return c.json({});

    // Devices on a fresh native install report version_name='builtin' until
    // the first OTA lands. Fall back to version_build (the Xcode
    // MARKETING_VERSION) for the comparison when that happens.
    const versionName = parsed.data.version_name;
    const versionBuild = parsed.data.version_build;
    const deviceVersion = versionName && versionName !== 'builtin' ? versionName : versionBuild;
    if (!deviceVersion) return c.json({});

    const manifest = await getManifest();
    if (!manifest) return c.json({});

    const m = semver.valid(semver.coerce(manifest.version));
    const d = semver.valid(semver.coerce(deviceVersion));
    if (!m || !d || !semver.gt(m, d)) return c.json({});

    const url = await createPresignedGetUrl(RELEASES_BUCKET, manifest.key, 3600);

    // Capacitor expects snake_case `session_key`. camelCase silently fails decryption.
    return c.json({
      version: manifest.version,
      url,
      checksum: manifest.checksum,
      session_key: manifest.sessionKey,
    });
  } catch (err) {
    console.error('[ota] update check failed:', err);
    return c.json({});
  }
});

export default app;
