/**
 * Server-side Supabase client using the service role key.
 *
 * BYPASSES Row-Level Security. Use only inside API route handlers where
 * authorization has already been enforced by the auth middleware.
 *
 * Never import this from client-side code — Vite would refuse to bundle
 * `process.env.SUPABASE_SERVICE_ROLE_KEY` anyway, but it's worth being clear.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let adminClient: SupabaseClient | null = null;

export function createAdminClient(): SupabaseClient {
  if (adminClient) return adminClient;

  const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl) {
    throw new Error('Missing VITE_SUPABASE_URL (or SUPABASE_URL) at admin client creation');
  }
  if (!serviceRoleKey) {
    throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY — admin operations require the service role key');
  }

  adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  return adminClient;
}
