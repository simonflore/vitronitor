import { Link, useNavigate } from 'react-router';
import { useNotes, useNoteMutations } from '@/lib/hooks/useNotes';

export default function NotesListPage() {
  const navigate = useNavigate();
  const { notes, isReady } = useNotes();
  const { createNote, deleteNote } = useNoteMutations();

  function onCreate() {
    const id = createNote({ title: 'Untitled' });
    navigate(`/notes/${id}`);
  }

  return (
    <main className="mx-auto max-w-2xl p-8">
      <header className="flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Notes</h1>
        <div className="flex gap-3 text-sm">
          <Link to="/home" className="text-zinc-500 hover:text-zinc-300">
            Home
          </Link>
          <button onClick={onCreate} className="rounded-md bg-indigo-500 px-3 py-1 font-medium text-white hover:bg-indigo-400">
            + New
          </button>
        </div>
      </header>

      {!isReady && <p className="mt-6 text-sm text-zinc-500">Syncing…</p>}

      {isReady && notes.length === 0 && (
        <p className="mt-6 text-sm text-zinc-500">
          No notes yet. Click <em>+ New</em> to add one.
        </p>
      )}

      {notes.length > 0 && (
        <ul className="mt-6 divide-y divide-zinc-800">
          {notes.map((n) => (
            <li key={n.id} className="flex items-center justify-between py-3">
              <Link to={`/notes/${n.id}`} className="block flex-1 hover:text-indigo-300">
                <div className="text-sm font-medium">{n.title || 'Untitled'}</div>
                {n.body && (
                  <div className="text-xs text-zinc-500 line-clamp-1">{n.body.slice(0, 120)}</div>
                )}
              </Link>
              <button
                onClick={() => {
                  if (confirm('Delete this note?')) deleteNote(n.id);
                }}
                className="ml-3 text-xs text-zinc-600 hover:text-red-400"
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-8 text-xs text-zinc-600">
        Changes sync in real-time across tabs and devices and persist offline (IndexedDB).
        Try editing in two browser tabs side-by-side, or refresh while offline.
      </p>
    </main>
  );
}
