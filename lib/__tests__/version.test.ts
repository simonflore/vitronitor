import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { APP_VERSION, forceUpdate } from '@/lib/version';
import pkg from '@/package.json';

describe('APP_VERSION', () => {
  it('matches package.json (kept in sync by scripts/sync-version.js)', () => {
    expect(APP_VERSION).toBe(pkg.version);
  });
});

describe('forceUpdate', () => {
  const reload = vi.fn();
  const originalLocation = window.location;

  beforeEach(() => {
    localStorage.clear();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...originalLocation, reload },
    });
  });

  afterEach(() => {
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: originalLocation,
    });
    reload.mockReset();
    vi.unstubAllGlobals();
  });

  it('clears web storage but keeps Supabase auth keys, then reloads', async () => {
    localStorage.setItem('sb-project-auth-token', 'token');
    localStorage.setItem('supabase.auth.session', 'session');
    localStorage.setItem('ui-theme', 'dark');

    await forceUpdate();

    expect(localStorage.getItem('sb-project-auth-token')).toBe('token');
    expect(localStorage.getItem('supabase.auth.session')).toBe('session');
    expect(localStorage.getItem('ui-theme')).toBeNull();
    expect(reload).toHaveBeenCalledOnce();
  });

  it('unregisters service workers and drops every cache', async () => {
    const unregister = vi.fn().mockResolvedValue(true);
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: { getRegistrations: vi.fn().mockResolvedValue([{ unregister }, { unregister }]) },
    });
    const del = vi.fn().mockResolvedValue(true);
    vi.stubGlobal('caches', { keys: vi.fn().mockResolvedValue(['a', 'b']), delete: del });

    await forceUpdate();

    expect(unregister).toHaveBeenCalledTimes(2);
    expect(del).toHaveBeenCalledWith('a');
    expect(del).toHaveBeenCalledWith('b');
    // @ts-expect-error -- remove the jsdom stub so later tests see no SW
    delete navigator.serviceWorker;
  });
});
