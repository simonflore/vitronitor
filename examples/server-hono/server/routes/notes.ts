/**
 * Notes CRUD API.
 *
 * M2: plain HTTP CRUD scoped by the resolved orgId. M3 wires this same
 * endpoint to the Electric collection's WAL (the client persists the
 * mutation locally first, then drains via this route when online).
 *
 * Soft-delete on DELETE (sets deleted_at) so Electric can stream the change
 * to all subscribers — hard deletes don't cleanly emit row events without
 * extra triggers.
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { withAuth, type AuthVariables } from '../middleware/auth';
import { createAdminClient } from '../../lib/supabase-admin';
import {
  createdResponse,
  successResponse,
  badRequestResponse,
  notFoundResponse,
  parseJsonBody,
} from '../lib/response';

const notes = new Hono<{ Variables: AuthVariables }>();
notes.use('*', withAuth);

const createNoteSchema = z.object({
  id: z.string().uuid().optional(),
  title: z.string().max(200).optional(),
  body: z.string().max(50_000).optional(),
});

const updateNoteSchema = z.object({
  title: z.string().max(200).optional(),
  body: z.string().max(50_000).optional(),
});

notes.get('/', async (c) => {
  const orgId = c.get('orgId');
  const admin = createAdminClient();

  const { data, error } = await admin
    .from('notes')
    .select('*')
    .eq('org_id', orgId)
    .is('deleted_at', null)
    .order('updated_at', { ascending: false });

  if (error) return c.json({ ok: false, error: error.message }, 500);
  return successResponse(c, data ?? []);
});

notes.post('/', async (c) => {
  const orgId = c.get('orgId');
  const user = c.get('user');

  const raw = await parseJsonBody(c);
  if (raw instanceof Response) return raw;

  const parsed = createNoteSchema.safeParse(raw);
  if (!parsed.success) return badRequestResponse(c, parsed.error.message);

  const admin = createAdminClient();
  const { data, error } = await admin
    .from('notes')
    .insert({
      ...(parsed.data.id && { id: parsed.data.id }),
      org_id: orgId,
      user_id: user.id,
      title: parsed.data.title ?? '',
      body: parsed.data.body ?? '',
    })
    .select()
    .single();

  if (error) return c.json({ ok: false, error: error.message }, 500);
  return createdResponse(c, data);
});

notes.patch('/:id', async (c) => {
  const orgId = c.get('orgId');
  const id = c.req.param('id');

  const raw = await parseJsonBody(c);
  if (raw instanceof Response) return raw;

  const parsed = updateNoteSchema.safeParse(raw);
  if (!parsed.success) return badRequestResponse(c, parsed.error.message);

  const admin = createAdminClient();
  const { data, error } = await admin
    .from('notes')
    .update(parsed.data)
    .eq('id', id)
    .eq('org_id', orgId)
    .is('deleted_at', null)
    .select()
    .maybeSingle();

  if (error) return c.json({ ok: false, error: error.message }, 500);
  if (!data) return notFoundResponse(c, 'Note');
  return successResponse(c, data);
});

notes.delete('/:id', async (c) => {
  const orgId = c.get('orgId');
  const id = c.req.param('id');

  // Soft delete — Electric publication needs the row to remain so subscribers
  // see the deleted_at change event. A purge job can hard-delete later.
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('notes')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)
    .eq('org_id', orgId)
    .is('deleted_at', null)
    .select()
    .maybeSingle();

  if (error) return c.json({ ok: false, error: error.message }, 500);
  if (!data) return notFoundResponse(c, 'Note');
  return successResponse(c, { id });
});

export default notes;
