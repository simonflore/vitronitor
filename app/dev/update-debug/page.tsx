import { Link } from 'react-router';
import { UpdateDebugPanel } from '@/components/admin/UpdateDebugPanel';

export default function UpdateDebugPage() {
  return (
    <main className="mx-auto max-w-2xl p-8">
      <header className="mb-6 flex items-baseline justify-between">
        <h1 className="text-xl font-semibold tracking-tight">OTA Debug</h1>
        <Link to="/settings" className="text-sm text-zinc-500 hover:text-zinc-300">
          ← Settings
        </Link>
      </header>
      <UpdateDebugPanel />
    </main>
  );
}
