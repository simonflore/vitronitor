/**
 * Server-side broadcast emitter for live-update propagation.
 *
 * Sends a `change` event on a Supabase Realtime topic after a mutation.
 * Clients subscribed to `org:${orgId}` or `user:${userId}` receive the event
 * and invalidate the matching TanStack Query key (see
 * `lib/realtime/broadcast-listener.tsx`).
 *
 * Uses Supabase's HTTP broadcast endpoint so emission is stateless — no
 * WebSocket connection from the API server.
 *
 * Best-effort: failures are logged but never thrown. Mutation success must
 * not depend on broadcast delivery; clients always refetch on focus/reconnect
 * as a safety net.
 */

export interface BroadcastChangeInput {
  /**
   * Org id for org-scoped tables. Accepts `null`/`undefined` so callers can
   * pass `c.get('orgId')` directly without `?? undefined`. If both `orgId`
   * and `userId` resolve to nullish, this call is a silent no-op.
   */
  orgId?: string | null;
  /** Provide for user-scoped tables (same null/undefined semantics). */
  userId?: string | null;
  /** Postgres table name (e.g. `'notes'`). */
  table: string;
  op: 'insert' | 'update' | 'delete';
  /**
   * Row id — clients can use this for single-row cache invalidation. The
   * default listener invalidates by table prefix only, so the collection
   * refreshes on every connected device regardless of the specific id sent.
   */
  id: string;
}

interface RealtimeMessage {
  topic: string;
  event: 'change';
  payload: { table: string; op: string; id: string };
  private: false;
}

export async function broadcastChange(input: BroadcastChangeInput): Promise<void> {
  const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    // Test/dev environments without Supabase config — silently skip.
    return;
  }

  const messages: RealtimeMessage[] = [];
  const payload = { table: input.table, op: input.op, id: input.id };

  if (input.orgId) {
    messages.push({ topic: `org:${input.orgId}`, event: 'change', payload, private: false });
  }
  if (input.userId) {
    messages.push({ topic: `user:${input.userId}`, event: 'change', payload, private: false });
  }
  if (messages.length === 0) return;

  try {
    const res = await fetch(`${supabaseUrl}/realtime/v1/api/broadcast`, {
      method: 'POST',
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ messages }),
    });
    if (!res.ok) {
      const body = await res.text();
      console.error(
        `[broadcast] Realtime broadcast returned ${res.status} for ${input.table}/${input.op}:`,
        body,
      );
    }
  } catch (err) {
    console.error(
      `[broadcast] Failed to send ${input.table}/${input.op}:`,
      err instanceof Error ? err.message : err,
    );
  }
}
