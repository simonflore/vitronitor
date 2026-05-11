import { RouterProvider } from 'react-router';
import { QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from '@/lib/contexts/AuthContext';
import { OrgProvider } from '@/lib/contexts/OrgContext';
import { NetworkProvider } from '@/lib/contexts/NetworkContext';
import { TanStackDbProvider } from '@/lib/sync/TanStackDbProvider';
import { OfflineBanner } from '@/components/layout/OfflineBanner';
import { queryClient } from '@/lib/query-client';
import { router } from './router';

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <NetworkProvider>
        <AuthProvider>
          <OrgProvider>
            <TanStackDbProvider>
              <OfflineBanner />
              <RouterProvider router={router} />
            </TanStackDbProvider>
          </OrgProvider>
        </AuthProvider>
      </NetworkProvider>
    </QueryClientProvider>
  );
}
