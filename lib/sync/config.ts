/**
 * Sync table scope helpers.
 *
 * The `/api/sync/:table` endpoint reads these to decide whether to filter
 * by `org_id` (the only scope vitronitor's reference example uses) and to
 * gate the allowlist of tables clients are permitted to sync.
 *
 * Multi-tenancy variants (per-user, per-team, per-workspace) follow the
 * same shape — add `USER_SCOPED_TABLES` etc. and the corresponding
 * `isUserScopedTable` predicate, then branch in `server/routes/sync.ts`.
 */

const ORG_SCOPED_TABLES = ['notes'] as const;

export type OrgScopedTable = (typeof ORG_SCOPED_TABLES)[number];

export function isOrgScopedTable(table: string): table is OrgScopedTable {
  return ORG_SCOPED_TABLES.includes(table as OrgScopedTable);
}

/** All tables exposed by `/api/sync/:table`. Exposed for tests / docs. */
export const ALL_SYNCED_TABLES: readonly string[] = [...ORG_SCOPED_TABLES];
