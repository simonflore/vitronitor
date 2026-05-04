/**
 * Auth context. Wraps Supabase session + sign-in/out helpers.
 *
 * Usage:
 *   const { user, status, signInWithEmail, signOut } = useAuth();
 *
 * status:
 *   'loading'   — initial getSession() in flight
 *   'signed-in' — user present
 *   'signed-out' — no session
 */

import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/client';

type AuthStatus = 'loading' | 'signed-in' | 'signed-out';

interface AuthContextValue {
  user: User | null;
  session: Session | null;
  status: AuthStatus;
  /** Sends a magic link. The user clicks the link in their inbox to complete sign-in. */
  signInWithEmail: (email: string) => Promise<{ error?: string }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const supabaseRef = useRef(createClient());
  const [session, setSession] = useState<Session | null>(null);
  const [status, setStatus] = useState<AuthStatus>('loading');

  useEffect(() => {
    const supabase = supabaseRef.current;

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setStatus(data.session ? 'signed-in' : 'signed-out');
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      setStatus(next ? 'signed-in' : 'signed-out');
    });

    return () => sub.subscription.unsubscribe();
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user: session?.user ?? null,
      session,
      status,
      async signInWithEmail(email) {
        const { error } = await supabaseRef.current.auth.signInWithOtp({
          email,
          options: {
            emailRedirectTo: `${window.location.origin}/#/auth/callback`,
          },
        });
        return error ? { error: error.message } : {};
      },
      async signOut() {
        await supabaseRef.current.auth.signOut();
      },
    }),
    [session, status],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
