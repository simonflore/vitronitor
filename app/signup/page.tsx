// Magic-link sign-up uses the same flow as sign-in (signInWithOtp creates the
// user on first call). This page exists for UX clarity — same component, just
// different copy. Replace with a richer form (org name, profile fields) when
// you need it.

import { useState } from 'react';
import { Link, Navigate } from 'react-router';
import { useAuth } from '@/lib/contexts/AuthContext';

export default function SignupPage() {
  const { status, signInWithEmail } = useAuth();
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (status === 'signed-in') return <Navigate to="/home" replace />;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    const result = await signInWithEmail(email);
    setSubmitting(false);
    if (result.error) setError(result.error);
    else setSent(true);
  }

  return (
    <main className="mx-auto max-w-md p-8">
      <h1 className="text-2xl font-semibold tracking-tight">Create your account</h1>
      <p className="mt-2 text-sm text-zinc-400">
        Enter your email and we&apos;ll send you a sign-in link. A workspace is
        created for you automatically on first sign-in.
      </p>

      {sent ? (
        <div className="mt-6 rounded-lg border border-emerald-800 bg-emerald-950/50 p-4 text-sm text-emerald-200">
          Check <strong>{email}</strong> for a sign-in link.
        </div>
      ) : (
        <form onSubmit={onSubmit} className="mt-6 space-y-3">
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
          />
          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-md bg-indigo-500 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-400 disabled:opacity-50"
          >
            {submitting ? 'Sending…' : 'Send sign-in link'}
          </button>
          {error && <p className="text-sm text-red-400">{error}</p>}
        </form>
      )}

      <p className="mt-6 text-sm text-zinc-500">
        Already have an account?{' '}
        <Link to="/login" className="text-indigo-400 hover:underline">
          Sign in
        </Link>
      </p>
    </main>
  );
}
