# Electric setup (M3)

Vitronitor uses [ElectricSQL](https://electric-sql.com) to stream Postgres changes
into local replicas (IndexedDB on web, SQLite on native in M7). The reference
setup uses **Electric Cloud**, but you can self-host the Electric source —
the only thing the boilerplate cares about is `ELECTRIC_API_URL` +
`ELECTRIC_SOURCE_ID` + `ELECTRIC_SOURCE_SECRET`.

## 1. Provision an Electric source

### Option A — Electric Cloud (fastest)

1. Sign up at https://electric-sql.com.
2. Create a source pointing at your Supabase pooler URL:
   `postgresql://postgres.<ref>:<password>@aws-0-eu-west-1.pooler.supabase.com:6543/postgres`
   (use the **transaction pooler** string from Supabase → Project Settings →
   Database; Electric needs `?sslmode=require` appended on some setups).
3. Copy the **Source ID** and **Source Secret** from the dashboard.
4. Set in `.env.local`:
   ```env
   ELECTRIC_API_URL=https://api.electric-sql.cloud
   ELECTRIC_SOURCE_ID=...
   ELECTRIC_SOURCE_SECRET=...
   ```

### Option B — Self-host

Run Electric in Docker against your Postgres directly. See the upstream docs
for the full guide. After it's running, set:

```env
ELECTRIC_API_URL=https://your-electric-host
ELECTRIC_SOURCE_ID=any-string
ELECTRIC_SOURCE_SECRET=any-string
```

The boilerplate proxy doesn't care about the upstream URL — it just forwards.

## 2. Verify the publication

The migration in M2 ran `ALTER PUBLICATION supabase_realtime ADD TABLE notes;`.
Verify with:

```sql
select schemaname, tablename
from pg_publication_tables
where pubname = 'supabase_realtime';
-- → notes should appear
```

If not, re-run the migration or apply manually.

## 3. Run

```bash
npm run dev
# https://localhost:3000
```

Sign in. Open `/notes`. Create a note → it should appear instantly. Open the
same URL in a second browser tab → both update in real time. Refresh in
airplane mode → notes still load from IndexedDB.

The `/api/electric/shape` proxy logs the upstream URL it builds — check
server logs if sync stalls.

## 4. Schema codegen

When you add a new table:

1. Add a Postgres migration under `supabase/migrations/`.
2. Add `public.<table>` to the `supabase_realtime` publication in the
   migration (or run `ALTER PUBLICATION supabase_realtime ADD TABLE <table>`).
3. Add the `Db<Name>` interface to `lib/db/types/<name>.ts`.
4. Add an entry to `TABLES[]` in `scripts/generate-electric-schemas.ts`.
5. Run:
   ```bash
   npx tsx scripts/generate-electric-schemas.ts
   ```
6. Add the table name to `ORG_SCOPED_TABLES` in `lib/electric/tables.ts`.
7. Create a collection file at `lib/electric/collections/<name>.ts` (mirror
   `notes.ts`).
8. Wire it into `lib/electric/TanStackDbProvider.tsx` (declare it in the
   collections record + the persistence hydrate effect).
9. Expose a hook at `lib/hooks/use<Name>.ts` (mirror `useNotes.ts`).

Six steps once you've done it once. The `notes` example is the canonical
template — `git grep notes` to see every place a new table touches.

## How sync works (1-minute mental model)

1. Client mounts → `TanStackDbProvider` instantiates `notesCollection` →
   Electric opens an HTTPS shape stream to `/api/electric/shape?table=notes`.
2. Vitronitor's proxy authenticates the request, injects
   `where: org_id = '<resolved>'`, and forwards to the Electric source.
3. Electric replays the existing rows (initial sync), then long-polls for
   new row events.
4. Each row event arrives as a JSON delta. The TanStack DB collection
   merges it; subscribers (the React hooks) re-render.
5. Mutations go the opposite way: client `collection.insert(row)` →
   `onInsert` → WAL persists → `apiFetch('/api/notes', POST)` →
   server inserts → Electric streams it back to all clients.

The "must-refetch 409" semantics: Electric tells clients to recreate their
shape if the underlying schema or filter changes. The factory's `onError`
handles this by stopping the stream — the provider then rebuilds a fresh
collection on next mount.
