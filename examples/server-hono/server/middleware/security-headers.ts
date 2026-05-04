import { createMiddleware } from 'hono/factory';

/**
 * Minimal security headers. Tighten as needed per deployment.
 *
 * - X-Content-Type-Options: nosniff       — block MIME sniffing
 * - X-Frame-Options: DENY                 — block clickjacking
 * - Referrer-Policy: strict-origin-when-cross-origin
 * - Permissions-Policy                    — opt out of unused powerful APIs
 *
 * No CSP here yet — it depends on which third parties you load (Supabase,
 * Sentry, Electric, your own S3 host). Add one per deployment.
 */
export const securityHeaders = createMiddleware(async (c, next) => {
  await next();
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('X-Frame-Options', 'DENY');
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  c.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
});
