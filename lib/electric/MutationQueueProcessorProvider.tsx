/**
 * Starts the mutation queue processor on mount, stops on unmount.
 *
 * Mounted once near the top of the React tree (App.tsx). Reads the current
 * orgId via the OrgContext getter and passes a getter into the processor so
 * org changes pick up automatically.
 */

import { useEffect, type ReactNode } from 'react';
import { startMutationQueueProcessor } from './mutation-queue-processor';
import { getCurrentOrgId } from '@/lib/contexts/OrgContext';

export function MutationQueueProcessorProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    return startMutationQueueProcessor(getCurrentOrgId);
  }, []);
  return <>{children}</>;
}
