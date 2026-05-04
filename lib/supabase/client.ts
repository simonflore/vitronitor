/**
 * Browser-side Supabase client (singleton).
 *
 * Uses @supabase/supabase-js directly. Auth state is persisted to localStorage
 * by default. M5+ wires native storage adapters (Capacitor Preferences /
 * Electron safeStorage) so sessions survive WebView eviction on device.
 */

import { createClient as createSupabaseClient, type SupabaseClient } from '@supabase/supabase-js';
import { getNativeAuthStorage } from './native-storage';

let client: SupabaseClient | null = null;

export function createClient(): SupabaseClient {
  if (client) return client;

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
  const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      'Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. ' +
        'Copy .env.example to .env.local and fill in your Supabase project credentials.',
    );
  }

  // On native (Capacitor/Electron) WebView storage gets evicted aggressively.
  // Back Supabase auth with platform-native storage (UserDefaults / safeStorage)
  // so sessions survive across app launches. On web, undefined → Supabase
  // uses localStorage (the default).
  const storage = getNativeAuthStorage();

  client = createSupabaseClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      ...(storage && { storage }),
    },
  });

  return client;
}
