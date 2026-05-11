/**
 * Shared TanStack Query client singleton.
 *
 * Used by:
 *   - `<QueryClientProvider>` in src/App.tsx — gives hooks access via context
 *   - `lib/sync/collections/factory.ts` — `queryCollectionOptions` reads/writes
 *     to this client so sync collections share one cache with any direct
 *     `useQuery` callers
 *   - `lib/realtime/broadcast-listener.tsx` — calls `invalidateQueries` when
 *     a Supabase Realtime `change` event arrives
 *   - `lib/sync/TanStackDbProvider.tsx` — clears the cache on logout / org
 *     switch so a re-login starts with a clean slate
 */

import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Sync collections drive their own invalidation via the broadcast
      // listener. Keep cached data fresh by default so navigating between
      // routes doesn't trigger a refetch storm.
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    },
  },
});
