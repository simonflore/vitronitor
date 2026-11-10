import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react-swc';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    include: ['**/*.{test,spec}.{ts,tsx}'],
    exclude: [
      '**/node_modules/**',
      'dist',
      'ios',
      'android',
      'examples',
      '.claude/worktrees/**',
    ],
    // Node 25+ ships an experimental global localStorage that shadows
    // jsdom's (and is undefined without --localstorage-file). Turn it off so
    // tests see jsdom's Storage on any Node version.
    execArgv: ['--no-experimental-webstorage'],
    env: {
      NODE_ENV: 'test',
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules',
        'ios',
        'android',
        'examples',
        '**/*.d.ts',
        '**/*.config.*',
        // Service worker: exercise it in a browser test, not under jsdom.
        'public/sw.js',
      ],
      // No floors yet: the boilerplate ships a seed suite only. When forking
      // into a real app, measure a baseline and set flat keys here
      // (branches/functions/lines/statements) ~2 points below it, as
      // gigmeister does. Vitest 4 ignores the old nested `global` shape.
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './'),
    },
    // React development build, so act() is available.
    conditions: ['development', 'browser'],
  },
});
