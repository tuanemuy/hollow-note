/**
 * Names of the global D1 schema.
 *
 * The DDL itself lives in `./migrations/*.sql` — that is what
 * `wrangler d1 migrations apply` and the test harness's
 * `readD1Migrations()` both read, so it has to be files on disk. This
 * module exists so the rest of the adapter can refer to a table without
 * spelling it, and so the conformance factory can wipe the plane between
 * backends — the workers pool isolates storage per file while the suites
 * contract for a fresh backend per test, and this plane is the one that
 * has to be emptied by hand rather than by taking a new name.
 *
 * The scope plane is delivered differently: nothing outside a Durable
 * Object can run DDL against its storage, so its schema is carried in the
 * object's own bundle (`../do/schema.ts`).
 */
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
  workspaceSlugReservations: "workspace_slug_reservations",
  invitationRoutes: "invitation_routes",
  noteRoutes: "note_routes",
  distributedOperations: "distributed_operations",
  accountDeletionManifests: "account_deletion_manifests",
  accountDeletionManifestItems: "account_deletion_manifest_items",
  globalMaintenanceRuns: "global_maintenance_runs",
  globalMaintenanceRunLanes: "global_maintenance_run_lanes",
  workspaceDirectory: "workspace_directory",
  publicNoteSearch: "public_note_search",
  publicNoteSearchTags: "public_note_search_tags",
  publicNoteSearchFts: "public_note_search_fts",
  outboxEvents: "outbox_events",
  processedEvents: "processed_events",
  scopeTaskDueIndex: "scope_task_due_index",
  occGuard: "_occ_guard",
} as const;

/**
 * Every ordinary table a fixture may have written. Derived rather than
 * listed again, so a table added to `GLOBAL_TABLES` cannot be left out of
 * the wipe. Deletion order is free — the schema declares no FOREIGN KEY —
 * and `_occ_guard` stays in even though it never holds a row. The FTS5
 * virtual table is the single exclusion; see `GLOBAL_WIPE_STATEMENTS`.
 */
export const GLOBAL_TABLES_TO_WIPE: readonly string[] = Object.values(
  GLOBAL_TABLES,
).filter((table) => table !== GLOBAL_TABLES.publicNoteSearchFts);

/**
 * Statements that empty the whole plane.
 *
 * A contentless FTS5 table cannot be emptied with `DELETE FROM` — there
 * is no content table to read the rows back out of — so it takes the
 * `delete-all` command instead.
 */
export const GLOBAL_WIPE_STATEMENTS: readonly string[] = [
  `INSERT INTO ${GLOBAL_TABLES.publicNoteSearchFts}(${GLOBAL_TABLES.publicNoteSearchFts}) VALUES('delete-all')`,
  ...GLOBAL_TABLES_TO_WIPE.map((table) => `DELETE FROM ${table}`),
];
