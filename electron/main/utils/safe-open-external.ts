/**
 * Wrapper around shell.openExternal that only forwards http/https/mailto.
 *
 * file://, javascript:, and custom-scheme URLs (vitronitor://, x-apple-...,
 * etc) can trigger OS handlers — including running JS in a fresh context or
 * launching helper apps with attacker-controlled arguments. Refuse anything
 * outside the safe-protocol allowlist.
 *
 * Use this from any electron/main entry point that forwards a URL coming from
 * renderer/web-content state (setWindowOpenHandler, will-navigate, etc).
 */

import { shell } from 'electron';

export function safeOpenExternal(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    console.warn('[security] refusing to openExternal — unparseable URL');
    return;
  }
  if (parsed.protocol === 'http:' || parsed.protocol === 'https:' || parsed.protocol === 'mailto:') {
    void shell.openExternal(url);
  } else {
    console.warn('[security] refusing to openExternal for protocol:', parsed.protocol);
  }
}
