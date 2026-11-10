import type { KnipConfig } from 'knip';

// Vitronitor is a boilerplate: some modules and exports exist for forks to
// wire up and are not imported by the demo app yet. They are listed below
// with the reason, so knip still fails on anything that is genuinely dead.
// When you fork, delete the entries you do not use along with the code.
const config: KnipConfig = {
  entry: [
    'electron/main/index.ts',
    'scripts/*.{js,ts}',
    // Public surface for forks (see docs/ELECTRON_OTA.md, BACKEND_CONTRACTS.md)
    'lib/hooks/useElectronUpdater.ts',
    // Imported by examples/server-hono, which is its own package
    'lib/sync/config.ts',
    'lib/db/types/index.ts',
  ],
  project: [
    'src/**/*.{ts,tsx}',
    'app/**/*.{ts,tsx}',
    'components/**/*.{ts,tsx}',
    'lib/**/*.{ts,tsx}',
    'electron/**/*.{ts,tsx}',
  ],
  ignore: [
    // Loaded by Electron via a path string, not a JS import
    'electron/main/preload.ts',
  ],
  ignoreIssues: {
    // Platform helpers kept as a complete set for forks
    'lib/platform.ts': ['exports'],
    // Row mappers and retry tuning exposed for app-specific collections
    'lib/sync/collections/notes.ts': ['exports'],
    'lib/sync/offline-executor.ts': ['exports'],
    'lib/sync/TanStackDbProvider.tsx': ['types'],
  },
  ignoreDependencies: [
    // Native platforms and plugins: registered by `cap sync`, not imported
    '@capacitor/ios',
    '@capacitor/android',
    '@capacitor/app',
    '@capacitor/splash-screen',
    '@capacitor/status-bar',
    // Shipped in the Electron package (scripts/pre-electron-build.js)
    'semver',
    '@types/semver',
    // Used via npx in scripts/publish-capacitor-bundle.sh
    '@capgo/cli',
    // Used via @tailwindcss/postcss plugin + CSS @import
    'tailwindcss',
    // Test scaffolding for component tests in forks
    '@testing-library/react',
    '@testing-library/user-event',
  ],
  ignoreExportsUsedInFile: true,
  exclude: ['duplicates'],
};

export default config;
