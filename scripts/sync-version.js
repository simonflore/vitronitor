#!/usr/bin/env node

/**
 * Syncs the version from package.json to:
 * - lib/version.ts            (APP_VERSION constant)
 * - public/sw.js              (service worker cache name)
 * - ios/App/App.xcodeproj/    (Xcode MARKETING_VERSION) — only if Capacitor iOS exists
 *
 * Runs automatically as the `prebuild` npm script.
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const version = packageJson.version;
const appName = packageJson.name; // e.g. "vitronitor" → cache name "vitronitor-v0.1.0"

function syncFile(relPath, regex, replacement, label) {
  const fullPath = path.join(root, relPath);
  if (!fs.existsSync(fullPath)) return;
  const before = fs.readFileSync(fullPath, 'utf8');
  const after = before.replace(regex, replacement);
  if (before === after) {
    console.log(`✓ ${label} already at ${version}`);
    return;
  }
  fs.writeFileSync(fullPath, after);
  console.log(`✓ Synced ${label} to ${version}`);
}

syncFile(
  'lib/version.ts',
  /export const APP_VERSION = '[^']+'/,
  `export const APP_VERSION = '${version}'`,
  'lib/version.ts',
);

syncFile(
  'public/sw.js',
  /const CACHE_NAME = '[^']+'/,
  `const CACHE_NAME = '${appName}-v${version}'`,
  'public/sw.js cache name',
);

syncFile(
  'ios/App/App.xcodeproj/project.pbxproj',
  /MARKETING_VERSION = [^;]+;/g,
  `MARKETING_VERSION = ${version};`,
  'Xcode MARKETING_VERSION',
);
