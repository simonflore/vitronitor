import * as fs from 'fs';
import * as path from 'path';
import JSZip from 'jszip';

/**
 * Extract a zip into `destDir` using JSZip (pure-JS pako inflate, fully
 * buffered). Not `extract-zip`/`yauzl`: their streaming
 * `zlib.createInflateRaw()` → file-write pipe deadlocks under Electron's
 * bundled Node (observed on Electron 43 / Node 24) on the first large
 * deflated entry. The promise never settles, so a renderer OTA bundle is
 * never promoted and the shell silently stays on the bundled renderer.
 * Backported from gigmeister (5ccd9c096).
 *
 * Guards against zip-slip: any entry that resolves outside `destDir` aborts
 * the whole extraction before anything outside it is written.
 */
export async function extractZipBuffered(zipPath: string, destDir: string): Promise<void> {
  const data = fs.readFileSync(zipPath);
  const zip = await JSZip.loadAsync(data);
  const destRoot = path.resolve(destDir);

  const entries = Object.values(zip.files);
  for (const entry of entries) {
    const target = path.resolve(destRoot, entry.name);
    if (target !== destRoot && !target.startsWith(destRoot + path.sep)) {
      throw new Error(`Zip entry escapes destination: ${entry.name}`);
    }
  }

  for (const entry of entries) {
    const target = path.resolve(destRoot, entry.name);
    if (entry.dir) {
      fs.mkdirSync(target, { recursive: true });
      continue;
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, await entry.async('nodebuffer'));
  }
}
