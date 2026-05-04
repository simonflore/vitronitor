import { createHashRouter, redirect } from 'react-router';
import { lazy, Suspense, type ComponentType } from 'react';

// Hash routing works identically in dev, prod (served by Hono), Electron (file://),
// and Capacitor (capacitor://localhost) without any server-side route config.

const HomePage = lazy(() => import('@/app/home/page'));
const LoginPage = lazy(() => import('@/app/login/page'));
const SignupPage = lazy(() => import('@/app/signup/page'));
const AuthCallbackPage = lazy(() => import('@/app/auth/callback/page'));
const SettingsPage = lazy(() => import('@/app/settings/page'));
const NotesListPage = lazy(() => import('@/app/notes/page'));
const NoteDetailPage = lazy(() => import('@/app/notes/[id]/page'));
const UpdateDebugPage = lazy(() => import('@/app/dev/update-debug/page'));

function PageFallback() {
  return <div style={{ padding: 24 }}>Loading…</div>;
}

function withSuspense(Component: ComponentType) {
  return (
    <Suspense fallback={<PageFallback />}>
      <Component />
    </Suspense>
  );
}

export const router = createHashRouter([
  { path: '/', loader: () => redirect('/home') },
  { path: '/home', element: withSuspense(HomePage) },
  { path: '/login', element: withSuspense(LoginPage) },
  { path: '/signup', element: withSuspense(SignupPage) },
  { path: '/auth/callback', element: withSuspense(AuthCallbackPage) },
  { path: '/settings', element: withSuspense(SettingsPage) },
  { path: '/notes', element: withSuspense(NotesListPage) },
  { path: '/notes/:id', element: withSuspense(NoteDetailPage) },
  { path: '/dev/update-debug', element: withSuspense(UpdateDebugPage) },
]);
