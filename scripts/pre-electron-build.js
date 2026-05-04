#!/usr/bin/env node
/**
 * Pre-electron-build prep.
 *
 * 1. Verifies dist/index.html exists (the SPA must be built before electron-builder).
 * 2. Stages required Electron-runtime npm modules into electron/dist/node_modules
 *    so they're picked up by the asar bundle. Native deps imported by
 *    electron/main/** are NOT auto-traced — without this, the packaged app
 *    throws "Cannot find module 'X'" at runtime for every transitive dep.
 *
 * To add a new native runtime dep:
 *   - install it (npm i foo)
 *   - add 'foo' AND its transitive deps to electronModules below
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DIST_INDEX = path.join(ROOT, 'dist', 'index.html');
const SRC_NODE_MODULES = path.join(ROOT, 'node_modules');
const DEST_NODE_MODULES = path.join(ROOT, 'electron', 'dist', 'node_modules');

if (!fs.existsSync(DIST_INDEX)) {
  console.error(
    'Error: dist/index.html missing. Run `npm run build` before electron-builder.',
  );
  process.exit(1);
}

// Modules used by electron/main/** at runtime, plus their transitive runtime deps.
// Keep this list exhaustive — electron-builder won't auto-trace them.
const electronModules = [
  // electron-updater (M8) + its transitive runtime deps used at update time.
  // electron-builder doesn't trace these from electron/main/**.
  'electron-updater',
  'builder-util-runtime',
  'fs-extra',
  'graceful-fs',
  'jsonfile',
  'universalify',
  'js-yaml',
  'argparse',
  'lazy-val',
  'lodash.escaperegexp',
  'lodash.isequal',
  'sax',
  'semver',
  // M9 — renderer-OTA needs extract-zip + transitive deps for bundle install.
  'extract-zip',
  'get-stream',
  'pump',
  'end-of-stream',
  'once',
  'wrappy',
  'debug',
  'ms',
];

if (electronModules.length === 0) {
  console.log('[pre-electron-build] no extra runtime modules to stage, skipping copy');
  process.exit(0);
}

fs.mkdirSync(DEST_NODE_MODULES, { recursive: true });

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

for (const name of electronModules) {
  const src = path.join(SRC_NODE_MODULES, name);
  if (!fs.existsSync(src)) {
    console.warn(`[pre-electron-build] missing module: ${name} — skipping`);
    continue;
  }
  const dest = path.join(DEST_NODE_MODULES, name);
  if (fs.existsSync(dest)) fs.rmSync(dest, { recursive: true, force: true });
  copyDir(src, dest);
  console.log(`[pre-electron-build] staged ${name}`);
}
