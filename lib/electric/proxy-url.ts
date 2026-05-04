import { getApiBaseUrl } from '@/lib/api-client';

/**
 * Resolve the URL the client should hit for Electric shape streams.
 *
 * Web: relative path (`/api/electric/shape`) — resolved against the page origin.
 * Native (Capacitor / Electron): absolute URL via `getApiBaseUrl()`.
 */
export function getElectricProxyUrl(): string {
  const base = getApiBaseUrl();
  if (base) return `${base}/api/electric/shape`;
  if (typeof window !== 'undefined') {
    return `${window.location.origin}/api/electric/shape`;
  }
  return '/api/electric/shape';
}
