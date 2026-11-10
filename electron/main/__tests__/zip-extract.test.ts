// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import JSZip from 'jszip';
import { extractZipBuffered } from '../zip-extract';

async function writeZip(file: string, entries: Record<string, string>): Promise<void> {
  const zip = new JSZip();
  for (const [name, contents] of Object.entries(entries)) zip.file(name, contents);
  fs.writeFileSync(file, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
}

describe('extractZipBuffered', () => {
  let tmp: string;
  let dest: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zip-extract-'));
    dest = path.join(tmp, 'out');
    fs.mkdirSync(dest);
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('extracts nested entries into the destination', async () => {
    const zipPath = path.join(tmp, 'bundle.zip');
    // A large, compressible entry: the shape that hung extract-zip's
    // streaming inflate under Electron 43.
    await writeZip(zipPath, {
      'index.html': '<!doctype html>',
      'assets/app.js': 'x'.repeat(2_000_000),
    });

    await extractZipBuffered(zipPath, dest);

    expect(fs.readFileSync(path.join(dest, 'index.html'), 'utf8')).toBe('<!doctype html>');
    expect(fs.statSync(path.join(dest, 'assets/app.js')).size).toBe(2_000_000);
  });

  it('rejects an entry that escapes the destination (zip-slip)', async () => {
    const zipPath = path.join(tmp, 'evil.zip');
    await writeZip(zipPath, { 'index.html': 'ok', '../escaped.txt': 'pwned' });

    await expect(extractZipBuffered(zipPath, dest)).rejects.toThrow(/escapes destination/);
    expect(fs.existsSync(path.join(tmp, 'escaped.txt'))).toBe(false);
  });
});
