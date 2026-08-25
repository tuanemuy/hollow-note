/**
 * Names of the global D1 schema, migration version 1.
 *
 * The DDL itself lives in `./migrations/*.sql` — that is what
 * `wrangler d1 migrations apply` and the test harness's
 * `readD1Migrations()` both read, so it has to be files on disk. This
 * module exists so the rest of the adapter can refer to a table without
 * spelling it, and so the conformance factory can wipe the plane between
 * backends without maintaining a second list
 * ([ADR 004](../../../../../.thread/11/adr.md)).
 *
 * The scope plane shares the migration version but not the delivery
 * mechanism: nothing outside a Durable Object can run DDL against its
 * storage, so its schema is carried in the object's own bundle
 * (`../do/schema.ts`).
 */
export const GLOBAL_MIGRATION_VERSION = 1;

export const GLOBAL_TABLES = {
  users: "users",
  identities: "identities",
  identityRemovalReceipts: "identity_removal_receipts",
  sessions: "sessions",
  authTokens: "auth_tokens",
  loginAttempts: "login_attempts",
  oauthFlowStates: "oauth_flow_states",
  identityUniqueReservations: "identity_unique_reservations",
  membershipDirectory: "membership_directory",
  noteRoutes: "note_routes",
  distributedOperations: "distributed_operations",
  accountDeletionManifests: "account_deletion_manifests",
  accountDeletionManifestItems: "account_deletion_manifest_items",
  globalMaintenanceRuns: "global_maintenance_runs",
  globalMaintenanceRunLanes: "global_maintenance_run_lanes",
  publicNoteSearch: "public_note_search",
  publicNoteSearchTags: "public_note_search_tags",
  publicNoteSearchFts: "public_note_search_fts",
  outboxEvents: "outbox_events",
  processedEvents: "processed_events",
  scopeTaskDueIndex: "scope_task_due_index",
  occGuard: "_occ_guard",
} as const;

/**
 * Every ordinary table a fixture may have written, in an order safe to
 * delete in. `_occ_guard` is included even though it never holds a row:
 * leaving it out would make "wipe everything" a claim the list cannot
 * back. The FTS5 virtual table is absent on purpose — see
 * `GLOBAL_WIPE_STATEMENTS`.
 */
export const GLOBAL_TABLES_IN_WIPE_ORDER: readonly string[] = [
  GLOBAL_TABLES.accountDeletionManifestItems,
  GLOBAL_TABLES.accountDeletionManifests,
  GLOBAL_TABLES.globalMaintenanceRunLanes,
  GLOBAL_TABLES.globalMaintenanceRuns,
  GLOBAL_TABLES.identities,
  GLOBAL_TABLES.identityRemovalReceipts,
  GLOBAL_TABLES.sessions,
  GLOBAL_TABLES.authTokens,
  GLOBAL_TABLES.loginAttempts,
  GLOBAL_TABLES.oauthFlowStates,
  GLOBAL_TABLES.identityUniqueReservations,
  GLOBAL_TABLES.membershipDirectory,
  GLOBAL_TABLES.noteRoutes,
  GLOBAL_TABLES.distributedOperations,
  GLOBAL_TABLES.publicNoteSearchTags,
  GLOBAL_TABLES.publicNoteSearch,
  GLOBAL_TABLES.outboxEvents,
  GLOBAL_TABLES.processedEvents,
  GLOBAL_TABLES.scopeTaskDueIndex,
  GLOBAL_TABLES.users,
  GLOBAL_TABLES.occGuard,
];

/**
 * Statements that empty the whole plane, in an order safe to run in.
 *
 * A contentless FTS5 table cannot be emptied with `DELETE FROM` — there
 * is no content table to read the rows back out of — so it takes the
 * `delete-all` command instead.
 */
export const GLOBAL_WIPE_STATEMENTS: readonly string[] = [
  `INSERT INTO ${GLOBAL_TABLES.publicNoteSearchFts}(${GLOBAL_TABLES.publicNoteSearchFts}) VALUES('delete-all')`,
  ...GLOBAL_TABLES_IN_WIPE_ORDER.map((table) => `DELETE FROM ${table}`),
];
