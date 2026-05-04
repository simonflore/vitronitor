/**
 * Magic-link callback page.
 *
 * Supabase's detectSessionInUrl=true (set in lib/supabase/client.ts) parses
 * the access_token from the URL hash automatically when the page loads.
 * We just wait for the AuthProvider to flip status to 'signed-in', then
 * redirect to /home. If the link was invalid we redirect back to /login.
 */

import { useEffect } from 'react';
import { useNavigate } from 'react-router';
import { useAuth } from '@/lib/contexts/AuthContext';

export default function AuthCallbackPage() {
  const { status } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (status === 'signed-in') navigate('/home', { replace: true });
    else if (status === 'signed-out') {
      // Give the URL parser one tick to settle; if still signed-out, redirect.
      const t = setTimeout(() => navigate('/login', { replace: true }), 1500);
      return () => clearTimeout(t);
    }
  }, [status, navigate]);

  return (
    <main className="mx-auto max-w-md p-8">
      <p className="text-sm text-zinc-400">Completing sign-in…</p>
    </main>
  );
}
