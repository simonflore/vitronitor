import { Link, Navigate } from 'react-router';
import { useAuth } from '@/lib/contexts/AuthContext';
import { useOrg } from '@/lib/contexts/OrgContext';
import { APP_VERSION } from '@/lib/version';

export default function SettingsPage() {
  const { user, status, signOut } = useAuth();
  const org = useOrg();

  if (status === 'loading') return <main className="p-8 text-zinc-400">Loading…</main>;
  if (!user) return <Navigate to="/login" replace />;

  return (
    <main className="mx-auto max-w-2xl p-8">
      <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>

      <section className="mt-6 space-y-2 rounded-lg border border-zinc-800 p-4">
        <h2 className="text-sm font-medium uppercase tracking-wider text-zinc-500">Account</h2>
        <p className="text-sm">
          Signed in as <span className="font-mono text-indigo-300">{user.email}</span>
        </p>
        <p className="text-xs text-zinc-500">User id: {user.id}</p>
      </section>

      <section className="mt-4 space-y-2 rounded-lg border border-zinc-800 p-4">
        <h2 className="text-sm font-medium uppercase tracking-wider text-zinc-500">Workspace</h2>
        {org.isLoading && <p className="text-sm text-zinc-500">Loading…</p>}
        {org.error && <p className="text-sm text-red-400">{org.error}</p>}
        {org.orgId && (
          <>
            <p className="text-sm">
              <span className="font-medium">{org.orgName ?? 'Untitled workspace'}</span>
            </p>
            <p className="text-xs text-zinc-500">Org id: {org.orgId}</p>
          </>
        )}
      </section>

      <section className="mt-4 space-y-2 rounded-lg border border-zinc-800 p-4">
        <h2 className="text-sm font-medium uppercase tracking-wider text-zinc-500">App</h2>
        <p className="text-sm">Version: {APP_VERSION}</p>
        <Link to="/dev/update-debug" className="block text-xs text-indigo-400 hover:underline">
          OTA debug →
        </Link>
      </section>

      <div className="mt-8 flex gap-3">
        <button
          onClick={() => signOut()}
          className="rounded-md bg-zinc-800 px-3 py-2 text-sm font-medium hover:bg-zinc-700"
        >
          Sign out
        </button>
        <Link
          to="/home"
          className="rounded-md border border-zinc-700 px-3 py-2 text-sm hover:border-zinc-500"
        >
          ← Home
        </Link>
      </div>
    </main>
  );
}
