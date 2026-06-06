/**
 * Renderer OTA — over-the-air updates for the Vite-built renderer.
 *
 * Pairs with the iOS Capgo path: same `.capgo_key_v2` signs both, same
 * RSA-PKCS1 + AES-128-CBC wire format, same `notifyReady`-or-rollback
 * confirmation pattern. Native shell stays on the (rare) electron-builder
 * release path; the renderer ships from CI on every renderer-only commit.
 *
 * State machine
 * -------------
 *   active    = last confirmed-good version (booted at least once with
 *               notifyReady firing). Loaded if there is no `pending`.
 *   pending   = freshly-downloaded version that hasn't been confirmed yet.
 *               Loaded preferentially over `active`.
 *   candidate = the version we're loading *this* boot, awaiting notifyReady.
 *               Cleared on confirmation.
 *
 *   Boot picks pending → active → bundled. If a candidate from the prior
 *   boot didn't confirm, treat it as broken: clear the pending or active
 *   slot it occupied, schedule its directory for deletion, load the next
 *   viable choice. So a bad pending falls back to active, not all the way
 *   to bundled.
 *
 * Public key
 * ----------
 * `PUBLIC_KEY_PEM` below MUST match the private half of `.capgo_key_v2`
 * AND the `publicKey` set in `capacitor.config.ts`. After running
 * `bash scripts/setup-signing-key.sh`, paste the printed PEM into both files.
 */

import { app, ipcMain, net } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { createWriteStream } from 'fs';
import extract from 'extract-zip';

// REPLACE this placeholder with the public PEM printed by setup-signing-key.sh.
// The same key is also pasted into capacitor.config.ts.
const PUBLIC_KEY_PEM = `-----BEGIN RSA PUBLIC KEY-----
REPLACE_WITH_YOUR_PUBLIC_KEY
-----END RSA PUBLIC KEY-----
`;

const DEFAULT_ENDPOINT = process.env.RENDERER_OTA_ENDPOINT || 'https://example.com/api/electron/bundle';
const INITIAL_CHECK_DELAY_MS = 30_000;
const RECURRING_CHECK_INTERVAL_MS = 60 * 60 * 1000; // 1h

type ElectronPlatform = 'electron-mac' | 'electron-win' | 'electron-linux';

interface RendererState {
  active: string | null;
  pending: string | null;
  candidate: string | null;
  lastCheck: string;
}

interface UpdateResponse {
  version: string;
  url: string;
  checksum: string;
  session_key: string;
  min_native_version: string;
}

let initialCheckTimer: NodeJS.Timeout | null = null;
let recurringCheckTimer: NodeJS.Timeout | null = null;

function getOtaRoot(): string {
  return path.join(app.getPath('userData'), 'renderer');
}
function getStateFile(): string {
  return path.join(getOtaRoot(), 'state.json');
}
function getVersionDir(version: string): string {
  return path.join(getOtaRoot(), version);
}
function getVersionIndexHtml(version: string): string {
  return path.join(getVersionDir(version), 'dist', 'index.html');
}
function getVersionDistDir(version: string): string {
  return path.join(getVersionDir(version), 'dist');
}
function getBundledIndexHtml(): string {
  // From electron/dist/main/, walk up to package root, then into dist/.
  return path.join(__dirname, '..', '..', '..', 'dist', 'index.html');
}
function getBundledDistDir(): string {
  return path.join(__dirname, '..', '..', '..', 'dist');
}

/** Absolute path to the dist directory of the renderer chosen by the last
 *  `resolveRendererPath()` call. The custom `app://` protocol handler in
 *  `electron/main/index.ts` reads files from here. Set during boot and kept
 *  stable for the BrowserWindow lifetime — OTA promotions take effect on the
 *  next launch via state.json. */
let activeRendererDir: string | null = null;

/** Returns the dist dir the renderer is currently being served from. The
 *  `app://` protocol handler reads from this. Falls back to the bundled
 *  dist if `resolveRendererPath()` hasn't run yet (defensive — should
 *  never happen since createWindow always calls it first). */
export function getActiveRendererDir(): string {
  return activeRendererDir ?? getBundledDistDir();
}

function loadState(): RendererState {
  const empty: RendererState = { active: null, pending: null, candidate: null, lastCheck: '' };
  try {
    if (!fs.existsSync(getStateFile())) return empty;
    const parsed = JSON.parse(fs.readFileSync(getStateFile(), 'utf8')) as Partial<RendererState>;
    return {
      active: typeof parsed.active === 'string' ? parsed.active : null,
      pending: typeof parsed.pending === 'string' ? parsed.pending : null,
      candidate: typeof parsed.candidate === 'string' ? parsed.candidate : null,
      lastCheck: typeof parsed.lastCheck === 'string' ? parsed.lastCheck : '',
    };
  } catch (e) {
    console.error('[renderer-ota] failed to load state, treating as empty:', e);
    return empty;
  }
}

function saveState(state: RendererState): void {
  fs.mkdirSync(getOtaRoot(), { recursive: true });
  const file = getStateFile();
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, file);
}

function isVersionExtracted(version: string): boolean {
  try {
    return fs.existsSync(getVersionIndexHtml(version));
  } catch {
    return false;
  }
}

function deleteVersionDir(version: string): void {
  try {
    fs.rmSync(getVersionDir(version), { recursive: true, force: true });
  } catch (e) {
    console.error(`[renderer-ota] failed to delete ${version}:`, e);
  }
}

function cleanupOldVersions(): void {
  try {
    const state = loadState();
    const keep = new Set(
      [state.active, state.pending, state.candidate].filter((v): v is string => Boolean(v)),
    );
    const root = getOtaRoot();
    if (!fs.existsSync(root)) return;
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      if (keep.has(entry.name)) continue;
      deleteVersionDir(entry.name);
    }
  } catch (e) {
    console.error('[renderer-ota] cleanupOldVersions failed:', e);
  }
}

/**
 * Synchronously decide which renderer to load on boot.
 * Hot path — write state.json at most once, defer all heavy fs cleanup
 * to setImmediate so BrowserWindow creation isn't blocked on disk I/O.
 */
export function resolveRendererPath(): string {
  const state = loadState();

  // Step 1: roll back if a prior boot's candidate didn't confirm.
  let active = state.active;
  let pending = state.pending;
  let toDelete: string | null = null;

  if (state.candidate) {
    console.log(`[renderer-ota] candidate ${state.candidate} did not confirm last boot — rolling back`);
    if (state.candidate === pending) pending = null;
    else if (state.candidate === active) active = null;
    if (state.candidate !== active && state.candidate !== pending) {
      toDelete = state.candidate;
    }
  }

  // Step 2: pick what to load (pending wins over active).
  let willLoad: string | null = null;
  if (pending && isVersionExtracted(pending)) willLoad = pending;
  else if (pending) pending = null;

  if (!willLoad && active && isVersionExtracted(active)) willLoad = active;
  else if (!willLoad && active) active = null;

  const next: RendererState = {
    active,
    pending,
    candidate: willLoad,
    lastCheck: state.lastCheck,
  };
  if (
    next.active !== state.active ||
    next.pending !== state.pending ||
    next.candidate !== state.candidate
  ) {
    saveState(next);
  }

  if (toDelete) setImmediate(() => deleteVersionDir(toDelete));

  if (willLoad) {
    console.log(`[renderer-ota] loading OTA renderer ${willLoad}`);
    activeRendererDir = getVersionDistDir(willLoad);
  } else {
    console.log('[renderer-ota] loading bundled renderer');
    activeRendererDir = getBundledDistDir();
  }

  // Serve the renderer over the registered `app://` scheme so OPFS, Service
  // Workers, and other secure-context APIs get a real origin. The protocol
  // handler in `electron/main/index.ts` maps `app://vitronitor/<path>` to
  // `<activeRendererDir>/<path>`.
  return 'app://vitronitor/index.html';
}

/**
 * RSA-PKCS1 verification: Capgo's signing scheme RSA-encrypts with the
 * private key on publish; we decrypt with the public key on receive.
 * Equivalent to PKCS#1 v1.5 signature verification.
 */
function rsaPublicDecrypt(ciphertext: Buffer): Buffer {
  return crypto.publicDecrypt(
    { key: PUBLIC_KEY_PEM, padding: crypto.constants.RSA_PKCS1_PADDING },
    ciphertext,
  );
}

function decryptBundleInPlace(
  encryptedPath: string,
  plaintextPath: string,
  sessionKeyWire: string,
  checksumHex: string,
): void {
  const parts = sessionKeyWire.split(':');
  if (parts.length !== 2) {
    throw new Error(`Invalid session_key format (expected "iv:key", got ${parts.length} parts)`);
  }
  const iv = Buffer.from(parts[0], 'base64');
  const encryptedAesKey = Buffer.from(parts[1], 'base64');
  if (iv.length !== 16) throw new Error(`Invalid IV length: ${iv.length}`);

  const aesKey = rsaPublicDecrypt(encryptedAesKey);
  if (aesKey.length !== 16) throw new Error(`Invalid AES key length: ${aesKey.length}`);

  const ciphertext = fs.readFileSync(encryptedPath);
  if (ciphertext.length === 0) throw new Error('Encrypted bundle is empty');

  const decipher = crypto.createDecipheriv('aes-128-cbc', aesKey, iv);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  if (plaintext.length === 0) throw new Error('Decrypted bundle is empty');

  const checksumCipher = Buffer.from(checksumHex, 'hex');
  if (checksumCipher.length !== 256) {
    throw new Error(`Invalid encrypted checksum length: ${checksumCipher.length} (expected 256 for RSA-2048)`);
  }
  const expectedHash = rsaPublicDecrypt(checksumCipher).toString('hex');
  const actualHash = crypto.createHash('sha256').update(plaintext).digest('hex');
  if (actualHash !== expectedHash) {
    throw new Error(`Checksum mismatch: expected ${expectedHash}, got ${actualHash}`);
  }

  fs.writeFileSync(plaintextPath, plaintext);
}

function getPlatformTag(): ElectronPlatform {
  switch (process.platform) {
    case 'darwin':
      return 'electron-mac';
    case 'win32':
      return 'electron-win';
    default:
      return 'electron-linux';
  }
}

async function postUpdateCheck(): Promise<UpdateResponse | null> {
  const state = loadState();
  const runningVersion = state.candidate ?? state.active;
  const body = JSON.stringify({
    version_name: runningVersion ?? 'builtin',
    version_build: app.getVersion(),
    native_version: app.getVersion(),
    platform: getPlatformTag(),
  });

  let res: Response;
  try {
    res = await fetch(DEFAULT_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
  } catch (e) {
    console.error('[renderer-ota] update check network error:', e);
    return null;
  }
  if (!res.ok) {
    console.error(`[renderer-ota] update check failed: HTTP ${res.status}`);
    return null;
  }

  const json = (await res.json()) as Partial<UpdateResponse>;
  if (!json.version || !json.url || !json.checksum || !json.session_key || !json.min_native_version) {
    return null;
  }
  return json as UpdateResponse;
}

async function downloadToFile(url: string, dest: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`);
  if (!res.body) throw new Error('Download response has no body');
  await pipeline(
    Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]),
    createWriteStream(dest),
  );
}

/**
 * One update check + download + verify + extract cycle.
 * Safe to call repeatedly; respects the rate-limit unless `force` is true.
 */
export async function checkForUpdate(force = false): Promise<{
  status: 'up-to-date' | 'updated' | 'rate-limited' | 'error';
  version?: string;
  error?: string;
}> {
  const before = loadState();

  // No network — skip without touching `lastCheck`, so the first call after we
  // come back online runs immediately instead of being rate-limited.
  if (!net.isOnline()) {
    return { status: 'up-to-date' };
  }

  if (!force && before.lastCheck) {
    const elapsed = Date.now() - new Date(before.lastCheck).getTime();
    if (elapsed < RECURRING_CHECK_INTERVAL_MS / 2) {
      return { status: 'rate-limited' };
    }
  }

  const checkedAt = new Date().toISOString();
  saveState({ ...before, lastCheck: checkedAt });

  const update = await postUpdateCheck();
  if (!update || update.version === before.active || update.version === before.pending) {
    return { status: 'up-to-date' };
  }

  console.log(`[renderer-ota] new renderer ${update.version} available — downloading`);

  const tmpRoot = path.join(getOtaRoot(), '.tmp');
  fs.mkdirSync(tmpRoot, { recursive: true });
  const encryptedZip = path.join(tmpRoot, `${update.version}.enc.zip`);
  const decryptedZip = path.join(tmpRoot, `${update.version}.zip`);
  const stagingDir = path.join(tmpRoot, `${update.version}.staging`);
  const finalDir = getVersionDir(update.version);

  try {
    await downloadToFile(update.url, encryptedZip);
    decryptBundleInPlace(encryptedZip, decryptedZip, update.session_key, update.checksum);

    fs.rmSync(stagingDir, { recursive: true, force: true });
    fs.mkdirSync(stagingDir, { recursive: true });
    await extract(decryptedZip, { dir: stagingDir });

    const finalDist = path.join(finalDir, 'dist');
    fs.rmSync(finalDir, { recursive: true, force: true });
    fs.mkdirSync(finalDir, { recursive: true });
    fs.renameSync(stagingDir, finalDist);

    if (!fs.existsSync(getVersionIndexHtml(update.version))) {
      throw new Error('Extracted bundle is missing dist/index.html');
    }

    saveState({
      active: before.active,
      pending: update.version,
      candidate: before.candidate,
      lastCheck: checkedAt,
    });

    console.log(`[renderer-ota] renderer ${update.version} staged as pending for next launch`);
    return { status: 'updated', version: update.version };
  } catch (e) {
    console.error('[renderer-ota] update failed:', e);
    fs.rmSync(finalDir, { recursive: true, force: true });
    return { status: 'error', error: e instanceof Error ? e.message : String(e) };
  } finally {
    fs.rmSync(encryptedZip, { force: true });
    fs.rmSync(decryptedZip, { force: true });
    fs.rmSync(stagingDir, { recursive: true, force: true });
  }
}

export function registerRendererOtaIpc(): void {
  ipcMain.on('renderer-ota:notify-ready', () => {
    const state = loadState();
    if (!state.candidate) return;
    console.log(`[renderer-ota] notifyReady — confirming ${state.candidate}`);

    const oldActive = state.active;
    let newActive = state.active;
    let newPending = state.pending;

    if (state.candidate === state.pending) {
      newActive = state.candidate;
      newPending = null;
    }
    // candidate === active → re-confirmed an already-known-good version.

    saveState({
      active: newActive,
      pending: newPending,
      candidate: null,
      lastCheck: state.lastCheck,
    });

    if (oldActive && oldActive !== newActive) {
      setImmediate(() => deleteVersionDir(oldActive));
    }
    cleanupOldVersions();
  });

  ipcMain.handle('renderer-ota:status', () => {
    const state = loadState();
    return {
      activeVersion: state.candidate ?? state.active,
      pendingVersion: state.pending,
      lastCheck: state.lastCheck,
      shellVersion: app.getVersion(),
    };
  });

  ipcMain.handle('renderer-ota:check-now', async () => {
    return checkForUpdate(true);
  });
}

export function scheduleUpdateCheck(): void {
  if (process.env.NODE_ENV === 'development') {
    console.log('[renderer-ota] skipping update check in dev');
    return;
  }
  if (initialCheckTimer || recurringCheckTimer) return;
  initialCheckTimer = setTimeout(() => void checkForUpdate(false), INITIAL_CHECK_DELAY_MS);
  recurringCheckTimer = setInterval(() => void checkForUpdate(false), RECURRING_CHECK_INTERVAL_MS);
}

export function stopUpdateCheck(): void {
  if (initialCheckTimer) {
    clearTimeout(initialCheckTimer);
    initialCheckTimer = null;
  }
  if (recurringCheckTimer) {
    clearInterval(recurringCheckTimer);
    recurringCheckTimer = null;
  }
}
