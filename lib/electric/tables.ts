/**
 * Electric table scoping registry — shared between client and server.
 *
 * To add a new collection:
 *   1. Add the table name to ORG_SCOPED_TABLES (or USER_SCOPED_TABLES).
 *   2. The proxy auto-injects `where: org_id = '<resolved>'` for org-scoped
 *      tables; user_id for user-scoped.
 *   3. Junction tables without an org_id column are filtered client-side via
 *      foreign keys — leave them out of these arrays.
 *
 * This file is server-safe: no DOM, no API client. The browser-only
 * `getElectricProxyUrl()` helper lives in ./proxy-url.ts.
 */

const ORG_SCOPED_TABLES = ['notes'] as const;
export type OrgScopedTable = (typeof ORG_SCOPED_TABLES)[number];

const USER_SCOPED_TABLES = [] as const;
export type UserScopedTable = (typeof USER_SCOPED_TABLES)[number];

export function isOrgScopedTable(table: string): table is OrgScopedTable {
  return (ORG_SCOPED_TABLES as readonly string[]).includes(table);
}

export function isUserScopedTable(table: string): table is UserScopedTable {
  return (USER_SCOPED_TABLES as readonly string[]).includes(table);
}
