/**
 * Storage IPC handlers.
 *
 * Generic encrypted key-value store backed by Electron safeStorage +
 * filesystem. The renderer uses this to back its Supabase auth session
 * (lib/supabase/native-storage.ts), so sessions survive between launches
 * and are encrypted at rest with the OS keychain (Keychain / DPAPI /
 * libsecret).
 *
 * Storage layout:
 *   <userData>/storage/<base64url(key)>.enc   — safeStorage-encrypted blobs
 *
 * Key encoding: base64url so arbitrary key strings (including '/' and ':')
 * map cleanly to filesystem entries.
 *
 * Falls back to plain JSON when safeStorage is unavailable (Linux without
 * libsecret) so the app still works — just without disk encryption.
 */

import { app, ipcMain, safeStorage } from 'electron';
import * as fs from 'fs/promises';
import * as path from 'path';

let storageDirPromise: Promise<string> | null = null;

async function getStorageDir(): Promise<string> {
  if (!storageDirPromise) {
    storageDirPromise = (async () => {
      const dir = path.join(app.getPath('userData'), 'storage');
      await fs.mkdir(dir, { recursive: true });
      return dir;
    })();
  }
  return storageDirPromise;
}

function keyToFilename(key: string): string {
  const b64 = Buffer.from(key, 'utf-8').toString('base64');
  // base64url: '+' → '-', '/' → '_', strip '='
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') + '.enc';
}

async function readKey(key: string): Promise<string | null> {
  try {
    const dir = await getStorageDir();
    const filePath = path.join(dir, keyToFilename(key));
    const buf = await fs.readFile(filePath);
    if (safeStorage.isEncryptionAvailable()) {
      try {
        return safeStorage.decryptString(buf);
      } catch {
        // Encryption key changed (OS reinstall) — drop the value.
        await fs.unlink(filePath).catch(() => {});
        return null;
      }
    }
    return buf.toString('utf-8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

async function writeKey(key: string, value: string): Promise<void> {
  const dir = await getStorageDir();
  const filePath = path.join(dir, keyToFilename(key));
  if (safeStorage.isEncryptionAvailable()) {
    await fs.writeFile(filePath, safeStorage.encryptString(value));
  } else {
    await fs.writeFile(filePath, value, 'utf-8');
  }
}

async function deleteKey(key: string): Promise<void> {
  try {
    const dir = await getStorageDir();
    await fs.unlink(path.join(dir, keyToFilename(key)));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
}

export function registerStorageIpc(): void {
  ipcMain.handle('app:version', () => app.getVersion());
  ipcMain.handle('app:platform', () => ({
    platform: process.platform,
    arch: process.arch,
    isDev: !app.isPackaged,
  }));

  ipcMain.handle('storage:get-item', async (_e, key: string) => readKey(key));
  ipcMain.handle('storage:set-item', async (_e, key: string, value: string) => writeKey(key, value));
  ipcMain.handle('storage:remove-item', async (_e, key: string) => deleteKey(key));
}
