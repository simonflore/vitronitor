/**
 * apiFetch — typed wrapper around fetch() that:
 *   - prepends the platform-appropriate API base URL
 *   - attaches the Supabase Bearer token automatically
 *   - unwraps the { ok, data } | { ok: false, error } envelope
 *
 * Offline mutation queuing is layered on top via the sync layer's
 * `@tanstack/offline-transactions` executor (see `lib/sync/offline-executor.ts`).
 */

import { createClient } from '@/lib/supabase/client';

interface ApiSuccess<T> {
  ok: true;
  data: T;
}

interface ApiError {
  ok: false;
  error: string;
  code?: string;
}

export class ApiFetchError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
  ) {
    super(message);
    this.name = 'ApiFetchError';
  }
}

/**
 * Resolve the API base URL.
 *
 *   Web (any browser context where the SPA is served from the same origin
 *        as the API — dev: vite proxies /api; prod: Hono serves both):
 *     return ''  → relative URLs work
 *
 *   Native (Capacitor/Electron, where the renderer loads from
 *           capacitor://localhost or file://):
 *     return import.meta.env.VITE_API_BASE_URL  → absolute URL required
 *
 * Detection: if the page origin is a `capacitor://` or `file://` URL we're
 * native. The native build env files set VITE_API_BASE_URL.
 */
export function getApiBaseUrl(): string {
  if (typeof window === 'undefined') return '';
  const origin = window.location.origin;
  if (origin.startsWith('capacitor://') || origin.startsWith('file://')) {
    return import.meta.env.VITE_API_BASE_URL ?? '';
  }
  return '';
}

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const base = getApiBaseUrl();
  const url = `${base}${path}`;

  // Attach bearer token (best-effort — anonymous endpoints don't require it)
  const headers = new Headers(init.headers);
  if (!headers.has('Authorization')) {
    try {
      const supabase = createClient();
      const { data } = await supabase.auth.getSession();
      if (data.session?.access_token) {
        headers.set('Authorization', `Bearer ${data.session.access_token}`);
      }
    } catch {
      // No supabase env yet — proceed unauthenticated.
    }
  }
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const res = await fetch(url, { ...init, headers });
  const text = await res.text();
  let json: ApiSuccess<T> | ApiError;
  try {
    json = text ? JSON.parse(text) : ({ ok: true, data: undefined as T });
  } catch {
    throw new ApiFetchError(`Non-JSON response from ${url}`, res.status);
  }

  if (!('ok' in json) || json.ok === false) {
    const err = json as ApiError;
    throw new ApiFetchError(err.error ?? `HTTP ${res.status}`, res.status, err.code);
  }
  return json.data;
}
