// electron-builder configuration. CJS module form (not JSON) so that
// publish.url can read process.env at build time.
//
// Why not JSON: electron-builder reads JSON literally — no env interpolation.
// We need API_URL or VITE_API_BASE_URL injected so the auto-updater feed
// URL points at the deployment, not a hardcoded host.

const apiUrl = process.env.API_URL || process.env.VITE_API_BASE_URL || 'https://example.com';

/** @type {import('electron-builder').Configuration} */
module.exports = {
  appId: process.env.ELECTRON_APP_ID || 'com.example.app.desktop',
  productName: process.env.ELECTRON_PRODUCT_NAME || 'Vitronitor',
  copyright: 'Copyright © 2026 Vitronitor contributors',

  directories: {
    output: 'dist-electron',
    buildResources: 'electron/public',
  },

  files: [
    'dist/**/*',
    '!dist/**/*.map',
    'electron/dist/**/*',
    '!electron/dist/**/*.map',
    '!electron/dist/node_modules/**/*',
    {
      from: 'electron/dist/node_modules',
      to: 'node_modules',
      filter: ['**/*', '!**/*.map'],
    },
  ],

  extraMetadata: {
    main: 'electron/dist/main/index.js',
  },

  protocols: {
    name: process.env.ELECTRON_PRODUCT_NAME || 'Vitronitor',
    schemes: [process.env.ELECTRON_URL_SCHEME || 'vitronitor'],
  },

  npmRebuild: true,
  asar: true,

  // electron-updater (M8) — generic HTTP provider hits the Hono server's
  // /api/electron/shell proxy. The Hono route serves yml manifests inline and
  // 302-redirects binary downloads to presigned S3 URLs.
  publish: {
    provider: 'generic',
    url: `${apiUrl}/api/electron/shell`,
  },

  mac: {
    hardenedRuntime: true,
    gatekeeperAssess: false,
    entitlements: 'electron/entitlements.mac.plist',
    entitlementsInherit: 'electron/entitlements.mac.plist',
    target: [
      { target: 'dmg', arch: ['arm64'] },
      { target: 'zip', arch: ['arm64'] }, // electron-updater needs the .zip
    ],
    category: 'public.app-category.utilities',
    icon: 'electron/public/icon.png',
  },
  win: {
    target: [{ target: 'nsis', arch: ['x64'] }],
    icon: 'electron/public/icon.ico',
  },
  linux: {
    target: [{ target: 'AppImage', arch: ['x64'] }],
    icon: 'electron/public',
    category: 'Utility',
  },
  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
  },
  dmg: {
    writeUpdateInfo: false,
    contents: [
      { x: 130, y: 220 },
      { x: 410, y: 220, type: 'link', path: '/Applications' },
    ],
  },
};
