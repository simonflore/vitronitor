/**
 * Subscribes to Supabase Realtime broadcast channels and invalidates the
 * matching TanStack Query keys when a `change` event arrives.
 *
 * Server emits via `examples/server-hono/server/lib/broadcast.ts` after every
 * mutation. The payload carries `{ table, op, id }`; we invalidate by table
 * prefix so both list queries (keyed `[table, orgId]`) and any single-row
 * queries (keyed `[table, id]`) refetch in the same React batch.
 *
 * Mounted inside `TanStackDbProvider` so the subscription lifecycle tracks
 * the auth/org flow — channels unsubscribe before the org id changes,
 * preventing stale handlers from invalidating queries scoped to the new org.
 */

import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/contexts/AuthContext';
import { useOrg } from '@/lib/contexts/OrgContext';
import { createClient } from '@/lib/supabase/client';

interface ChangePayload {
  table: string;
  op: 'insert' | 'update' | 'delete';
  id: string;
}

export function BroadcastListener() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { orgId } = useOrg();

  useEffect(() => {
    if (!user?.id && !orgId) return;

    const supabase = createClient();
    const channels: ReturnType<typeof supabase.channel>[] = [];

    const handleChange = (event: unknown) => {
      const payload = (event as { payload?: ChangePayload }).payload;
      if (!payload?.table) return;
      void queryClient.invalidateQueries({ queryKey: [payload.table] });
    };

    if (orgId) {
      const ch = supabase
        .channel(`org:${orgId}`)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .on('broadcast' as any, { event: 'change' }, handleChange)
        .subscribe();
      channels.push(ch);
    }
    if (user?.id) {
      const ch = supabase
        .channel(`user:${user.id}`)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .on('broadcast' as any, { event: 'change' }, handleChange)
        .subscribe();
      channels.push(ch);
    }

    return () => {
      channels.forEach((ch) => {
        void supabase.removeChannel(ch);
      });
    };
  }, [orgId, user?.id, queryClient]);

  return null;
}
