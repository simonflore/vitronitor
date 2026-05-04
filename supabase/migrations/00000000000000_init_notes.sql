-- Initial schema for the Vitronitor boilerplate.
--
-- Tables:
--   orgs           — tenant container (one per user by default; see trigger below)
--   org_members    — junction table user ⇄ org with role
--   notes          — example domain table demonstrating org-scoped data
--
-- Row-level security:
--   All tables enforce membership via auth.uid(). Service role bypasses RLS.
--
-- Single-org assumption:
--   The on_auth_user_created trigger creates one org per new user and adds them
--   as owner. To support multi-org, drop this trigger and provide a different
--   org-creation flow (invite codes, "create another org" button, etc.).
--   The auth middleware would also need to read X-Org-Id from the request
--   header and validate membership, instead of falling back to the user's
--   first org_members row.

-- ===========================================================================
-- Tables
-- ===========================================================================

create table public.orgs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table public.org_members (
  org_id uuid not null references public.orgs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'admin', 'member')),
  joined_at timestamptz not null default now(),
  primary key (org_id, user_id)
);

create index org_members_user_id_idx on public.org_members (user_id);

create table public.notes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default '',
  body text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index notes_org_id_idx on public.notes (org_id) where deleted_at is null;
create index notes_updated_at_idx on public.notes (org_id, updated_at desc) where deleted_at is null;

-- ===========================================================================
-- Triggers
-- ===========================================================================

-- Maintain notes.updated_at on every UPDATE.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger notes_updated_at
before update on public.notes
for each row execute function public.set_updated_at();

-- One org per new user. To support multi-org sign-up flows, drop this trigger
-- and create the org through the application instead.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  new_org_id uuid;
begin
  insert into public.orgs (name)
  values (coalesce(new.raw_user_meta_data->>'org_name', 'My Workspace'))
  returning id into new_org_id;

  insert into public.org_members (org_id, user_id, role)
  values (new_org_id, new.id, 'owner');

  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- ===========================================================================
-- Row-Level Security
-- ===========================================================================

alter table public.orgs enable row level security;
alter table public.org_members enable row level security;
alter table public.notes enable row level security;

-- Helper: which orgs is the current user a member of?
create or replace function public.user_org_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select org_id from public.org_members where user_id = auth.uid();
$$;

-- orgs: users see orgs they're members of.
create policy "orgs_select_member"
  on public.orgs for select
  using (id in (select public.user_org_ids()));

-- org_members: users see their own membership rows + rows for orgs they belong to.
create policy "org_members_select"
  on public.org_members for select
  using (user_id = auth.uid() or org_id in (select public.user_org_ids()));

-- notes: full CRUD scoped to the user's orgs.
create policy "notes_select"
  on public.notes for select
  using (org_id in (select public.user_org_ids()));

create policy "notes_insert"
  on public.notes for insert
  with check (org_id in (select public.user_org_ids()) and user_id = auth.uid());

create policy "notes_update"
  on public.notes for update
  using (org_id in (select public.user_org_ids()))
  with check (org_id in (select public.user_org_ids()));

create policy "notes_delete"
  on public.notes for delete
  using (org_id in (select public.user_org_ids()));

-- ===========================================================================
-- Electric publication (M3 turns this on; harmless to ship now)
-- ===========================================================================
-- The Electric source streams Postgres changes to clients. Adding `notes` to
-- the supabase_realtime publication ensures Electric receives row events.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.notes;
  end if;
end;
$$;
