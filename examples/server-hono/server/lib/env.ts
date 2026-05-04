/**
 * Validates required environment variables at server boot.
 *
 * Add new required vars here so misconfigured deployments fail fast at
 * startup instead of silently 500ing the first time the dependency is
 * touched.
 */

interface RequiredVar {
  name: string;
  required: boolean;
  hint: string;
}

const VARS: RequiredVar[] = [
  // Supabase — required: auth/CRUD won't work without these
  { name: 'VITE_SUPABASE_URL', required: true, hint: 'Supabase project URL' },
  { name: 'VITE_SUPABASE_ANON_KEY', required: true, hint: 'Supabase anon (public) key' },
  { name: 'SUPABASE_SERVICE_ROLE_KEY', required: true, hint: 'Supabase service-role key (server-only)' },
  // Electric — required: Electric proxy refuses to serve without these
  { name: 'ELECTRIC_SOURCE_ID', required: true, hint: 'Electric Cloud source id' },
  { name: 'ELECTRIC_SOURCE_SECRET', required: true, hint: 'Electric Cloud source secret' },
  // Object store — required for OTA pipelines so /api/capacitor/bundle doesn't 500
  { name: 'S3_ENDPOINT', required: true, hint: 'S3-compatible object store endpoint' },
  { name: 'S3_ACCESS_KEY_ID', required: true, hint: 'S3-compatible access key' },
  { name: 'S3_SECRET_ACCESS_KEY', required: true, hint: 'S3-compatible secret key' },
];

export function validateEnv(): void {
  const missing = VARS.filter((v) => v.required && !process.env[v.name]);
  if (missing.length === 0) return;

  console.error('\n[vitronitor] Missing required environment variables:\n');
  for (const v of missing) {
    console.error(`  - ${v.name}: ${v.hint}`);
  }
  console.error('\nSet these in .env.local (gitignored) or your deployment env.\n');
  process.exit(1);
}
