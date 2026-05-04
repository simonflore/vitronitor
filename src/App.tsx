import { RouterProvider } from 'react-router';
import { AuthProvider } from '@/lib/contexts/AuthContext';
import { OrgProvider } from '@/lib/contexts/OrgContext';
import { NetworkProvider } from '@/lib/contexts/NetworkContext';
import { TanStackDbProvider } from '@/lib/electric/TanStackDbProvider';
import { MutationQueueProcessorProvider } from '@/lib/electric/MutationQueueProcessorProvider';
import { OfflineBanner } from '@/components/layout/OfflineBanner';
import { router } from './router';

export default function App() {
  return (
    <NetworkProvider>
      <AuthProvider>
        <OrgProvider>
          <TanStackDbProvider>
            <MutationQueueProcessorProvider>
              <OfflineBanner />
              <RouterProvider router={router} />
            </MutationQueueProcessorProvider>
          </TanStackDbProvider>
        </OrgProvider>
      </AuthProvider>
    </NetworkProvider>
  );
}
