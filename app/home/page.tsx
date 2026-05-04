import { Link } from 'react-router';
import { useAuth } from '@/lib/contexts/AuthContext';
import { useOrg } from '@/lib/contexts/OrgContext';
import { useNotes } from '@/lib/hooks/useNotes';

export default function HomePage() {
  const { user, status, signOut } = useAuth();
  const org = useOrg();
  const { notes, isReady } = useNotes();

  return (
    <main className="mx-auto max-w-2xl p-8">
      <header className="flex items-baseline justify-between">
        <h1 className="text-3xl font-semibold tracking-tight">Vitronitor</h1>
        {user ? (
          <Link to="/settings" className="text-sm text-indigo-400 hover:underline">
            Settings
          </Link>
        ) : (
          <Link to="/login" className="text-sm text-indigo-400 hover:underline">
            Sign in
          </Link>
        )}
      </header>

      <p className="mt-2 text-zinc-400">
        Cross-platform offline-first React boilerplate. M3 wires the notes table to
        Electric for real-time sync + offline persistence.
      </p>

      {status === 'loading' && <p className="mt-6 text-sm text-zinc-500">Loading…</p>}

      {status === 'signed-out' && (
        <section className="mt-8 rounded-lg border border-zinc-800 p-6">
          <p className="text-sm">
            <Link to="/login" className="text-indigo-400 hover:underline">
              Sign in
            </Link>{' '}
            to see your notes.
          </p>
        </section>
      )}

      {status === 'signed-in' && org.orgId && (
        <section className="mt-8 rounded-lg border border-zinc-800 p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium uppercase tracking-wider text-zinc-500">
              Notes ({notes.length})
            </h2>
            <Link to="/notes" className="text-sm text-indigo-400 hover:underline">
              Open →
            </Link>
          </div>
          {!isReady && <p className="mt-2 text-sm text-zinc-500">Syncing…</p>}
          {isReady && notes.length === 0 && (
            <p className="mt-2 text-sm text-zinc-500">No notes yet.</p>
          )}
          {notes.length > 0 && (
            <ul className="mt-3 divide-y divide-zinc-800">
              {notes.slice(0, 5).map((n) => (
                <li key={n.id} className="py-2 text-sm">
                  <Link to={`/notes/${n.id}`} className="hover:text-indigo-300">
                    <span className="font-medium">{n.title || 'Untitled'}</span>
                    {n.body && <span className="ml-2 text-zinc-500">— {n.body.slice(0, 80)}</span>}
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-xs text-zinc-600">
            Real-time across tabs. Persists to IndexedDB. Works offline.
          </p>
        </section>
      )}

      {status === 'signed-in' && (
        <button
          onClick={() => signOut()}
          className="mt-8 text-sm text-zinc-500 hover:text-zinc-300"
        >
          Sign out
        </button>
      )}
    </main>
  );
}
