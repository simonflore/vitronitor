import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useDebouncedCallback } from 'use-debounce';
import { useNote, useNoteMutations } from '@/lib/hooks/useNotes';

export default function NoteDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { note, isReady } = useNote(id);
  const { updateNote, deleteNote } = useNoteMutations();

  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');

  // Hydrate local state from the synced note when it appears.
  useEffect(() => {
    if (note) {
      /* eslint-disable react-hooks/set-state-in-effect -- sync external (collection) state into form state when the note id changes */
      setTitle(note.title);
      setBody(note.body);
      /* eslint-enable react-hooks/set-state-in-effect */
    }
  }, [note?.id]);  // eslint-disable-line react-hooks/exhaustive-deps

  const debouncedTitle = useDebouncedCallback((next: string) => {
    if (id) updateNote(id, { title: next });
  }, 400);

  const debouncedBody = useDebouncedCallback((next: string) => {
    if (id) updateNote(id, { body: next });
  }, 400);

  function onDelete() {
    if (!id) return;
    if (!confirm('Delete this note?')) return;
    deleteNote(id);
    navigate('/notes');
  }

  if (!isReady && !note) {
    return <main className="p-8 text-sm text-zinc-500">Loading…</main>;
  }
  if (isReady && !note) {
    return (
      <main className="p-8">
        <p className="text-sm text-zinc-500">Note not found.</p>
        <Link to="/notes" className="mt-4 inline-block text-sm text-indigo-400 hover:underline">
          ← Back to notes
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-2xl p-8">
      <header className="mb-6 flex items-center justify-between text-sm">
        <Link to="/notes" className="text-zinc-500 hover:text-zinc-300">
          ← Notes
        </Link>
        <button onClick={onDelete} className="text-zinc-600 hover:text-red-400">
          Delete
        </button>
      </header>

      <input
        value={title}
        onChange={(e) => {
          setTitle(e.target.value);
          debouncedTitle(e.target.value);
        }}
        placeholder="Title"
        className="w-full bg-transparent text-2xl font-semibold tracking-tight focus:outline-none"
      />

      <textarea
        value={body}
        onChange={(e) => {
          setBody(e.target.value);
          debouncedBody(e.target.value);
        }}
        placeholder="Start writing…"
        rows={20}
        className="mt-4 w-full resize-none bg-transparent text-base leading-relaxed focus:outline-none"
      />

      <p className="mt-6 text-xs text-zinc-600">
        Autosaves every keystroke (400ms debounced). Edits in another tab arrive in real time.
      </p>
    </main>
  );
}
