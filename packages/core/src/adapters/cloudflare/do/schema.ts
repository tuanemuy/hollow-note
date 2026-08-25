import { OCC_GUARD_DDL } from "../sql/occGuard";

/**
 * Scope-plane schema, carried in the Durable Object's own bundle.
 *
 * The two planes carry the same schema generation but not the same
 * delivery mechanism: nothing outside a Durable Object can run DDL
 * against its storage, so the scope schema is statements in the bundle
 * rather than files a migration runner reads. `SCOPE_SCHEMA_STATEMENTS`
 * is idempotent and `ScopeObject` runs it on every activation, which is
 * what makes "an object that has never been touched already has its
 * tables" true without a deploy step.
 */
export const SCHEDULED_TASKS_TABLE = "scheduled_tasks";

export const SCOPE_TABLES = {
  scopeIdentity: "_scope_identity",
  occGuard: "_occ_guard",
  notes: "notes",
  noteProjectionRevisions: "note_projection_revisions",
  noteRevisions: "note_revisions",
  storedFiles: "stored_files",
  storageQuotas: "storage_quotas",
  llmUsages: "llm_usages",
  noteSearch: "note_search",
  noteSearchTags: "note_search_tags",
  noteSearchFts: "note_search_fts",
  outboxEvents: "outbox_events",
  processedEvents: "processed_events",
  scheduledTasks: SCHEDULED_TASKS_TABLE,
  appliedOperations: "applied_operations",
} as const;

/**
 * DDL of one scope object, in dependency order. Every statement is
 * `IF NOT EXISTS` so re-running it on an already-initialised object is a
 * no-op.
 *
 * No FOREIGN KEY declarations, for the same reason as the global plane —
 * see the header of `../d1/migrations/0001_global_schema.sql`.
 */
export const SCOPE_SCHEMA_STATEMENTS: readonly string[] = [
  // The object's own ScopeKey, pinned on first contact. Every scope
  // table carries `owner_type`/`owner_id` (or `scope_type`/`scope_id`)
  // and the adapter checks them against this row on both restore and
  // save (`spec/database/index.md` の「共通の規約」: scope 検証).
  `CREATE TABLE IF NOT EXISTS ${SCOPE_TABLES.scopeIdentity} (
     id integer PRIMARY KEY CHECK (id = 0),
     scope_type text NOT NULL CHECK (scope_type IN ('user', 'workspace')),
     scope_id text NOT NULL
   )`,

  OCC_GUARD_DDL.replace("CREATE TABLE", "CREATE TABLE IF NOT EXISTS"),

  `CREATE TABLE IF NOT EXISTS ${SCOPE_TABLES.notes} (
     id text PRIMARY KEY,
     owner_type text NOT NULL CHECK (owner_type IN ('user', 'workspace')),
     owner_id text NOT NULL,
     created_by text NOT NULL,
     title text NOT NULL,
     title_origin text NOT NULL CHECK (title_origin IN ('auto', 'manual')),
     content_status text NOT NULL CHECK (content_status IN ('processing', 'awaitingIntegration', 'failed', 'ready')),
     content_html text,
     content_text text,
     content_excerpt text,
     content_headings text,
     content_failure_reason text,
     visibility text NOT NULL CHECK (visibility IN ('private', 'unlisted', 'public')),
     published_at integer,
     share_token_hash text,
     share_token_ciphertext text,
     share_token_key_version integer,
     share_password_hash text,
     share_password_updated_at integer,
     share_issued_at integer,
     style_mode text NOT NULL CHECK (style_mode IN ('default', 'preserve')),
     source_file_id text,
     lifecycle text NOT NULL CHECK (lifecycle IN ('active', 'trashed')),
     trashed_at integer,
     purge_after integer,
     version integer NOT NULL DEFAULT 0,
     created_at integer NOT NULL,
     updated_at integer NOT NULL,
     CHECK ((content_status = 'ready') = (content_html IS NOT NULL)),
     CHECK ((content_status = 'ready') = (content_text IS NOT NULL)),
     CHECK ((content_status = 'ready') = (content_excerpt IS NOT NULL)),
     CHECK ((content_status = 'ready') = (content_headings IS NOT NULL)),
     CHECK ((content_status = 'failed') = (content_failure_reason IS NOT NULL)),
     CHECK (visibility <> 'unlisted' OR share_token_hash IS NOT NULL),
     CHECK ((share_token_hash IS NULL) = (share_token_ciphertext IS NULL)),
     CHECK ((share_token_hash IS NULL) = (share_token_key_version IS NULL)),
     CHECK ((share_token_hash IS NULL) = (share_issued_at IS NULL)),
     CHECK ((share_password_hash IS NULL) = (share_password_updated_at IS NULL)),
     CHECK (visibility <> 'public' OR (share_password_hash IS NULL AND published_at IS NOT NULL)),
     CHECK (visibility NOT IN ('unlisted', 'public') OR content_status = 'ready'),
     CHECK ((lifecycle = 'trashed') = (trashed_at IS NOT NULL)),
     CHECK ((lifecycle = 'trashed') = (purge_after IS NOT NULL))
   )`,
  `CREATE INDEX IF NOT EXISTS notes_owner_lifecycle_updated_idx
     ON ${SCOPE_TABLES.notes} (owner_type, owner_id, lifecycle, updated_at DESC)`,
  `CREATE INDEX IF NOT EXISTS notes_purge_idx
     ON ${SCOPE_TABLES.notes} (purge_after) WHERE lifecycle = 'trashed'`,

  `CREATE TABLE IF NOT EXISTS ${SCOPE_TABLES.noteProjectionRevisions} (
     note_id text PRIMARY KEY,
     revision integer NOT NULL CHECK (revision >= 1)
   )`,

  `CREATE TABLE IF NOT EXISTS ${SCOPE_TABLES.noteRevisions} (
     id text PRIMARY KEY,
     note_id text NOT NULL,
     html text NOT NULL,
     title text NOT NULL,
     title_origin text NOT NULL CHECK (title_origin IN ('auto', 'manual')),
     style_mode text NOT NULL CHECK (style_mode IN ('default', 'preserve')),
     created_by text NOT NULL,
     created_at integer NOT NULL,
     reason text NOT NULL CHECK (reason IN ('manualEdit', 'regeneration', 'wysiwygConversion', 'restore'))
   )`,
  `CREATE INDEX IF NOT EXISTS note_revisions_note_created_idx
     ON ${SCOPE_TABLES.noteRevisions} (note_id, created_at DESC)`,

  `CREATE TABLE IF NOT EXISTS ${SCOPE_TABLES.storedFiles} (
     id text PRIMARY KEY,
     owner_type text NOT NULL CHECK (owner_type IN ('user', 'workspace')),
     owner_id text NOT NULL,
     uploaded_by text,
     purpose text NOT NULL CHECK (purpose IN ('source', 'media', 'reference', 'artifact', 'avatar')),
     note_id text,
     note_version integer,
     object_key text NOT NULL UNIQUE,
     file_name text NOT NULL,
     mime_type text NOT NULL,
     size integer NOT NULL CHECK (size >= 0),
     checksum_algorithm text NOT NULL CHECK (checksum_algorithm IN ('sha256')),
     checksum_value text NOT NULL,
     retention text NOT NULL CHECK (retention IN ('persistent', 'ephemeral')),
     expires_at integer,
     version integer NOT NULL DEFAULT 0,
     created_at integer NOT NULL,
     updated_at integer NOT NULL,
     CHECK (purpose NOT IN ('source', 'media', 'reference') OR note_id IS NOT NULL),
     CHECK (purpose <> 'avatar' OR note_id IS NULL),
     CHECK (purpose <> 'artifact' OR (note_id IS NULL) = (note_version IS NULL)),
     CHECK (purpose = 'artifact' OR note_version IS NULL),
     CHECK (uploaded_by IS NOT NULL OR purpose = 'artifact'),
     CHECK (purpose <> 'artifact' OR retention = 'ephemeral'),
     CHECK ((retention = 'ephemeral') = (expires_at IS NOT NULL))
   )`,
  `CREATE INDEX IF NOT EXISTS stored_files_owner_idx
     ON ${SCOPE_TABLES.storedFiles} (owner_type, owner_id, purpose)`,
  `CREATE INDEX IF NOT EXISTS stored_files_expires_idx
     ON ${SCOPE_TABLES.storedFiles} (expires_at) WHERE retention = 'ephemeral'`,
  `CREATE INDEX IF NOT EXISTS stored_files_purpose_created_idx
     ON ${SCOPE_TABLES.storedFiles} (purpose, created_at)`,
  `CREATE INDEX IF NOT EXISTS stored_files_note_idx
     ON ${SCOPE_TABLES.storedFiles} (note_id) WHERE note_id IS NOT NULL`,

  `CREATE TABLE IF NOT EXISTS ${SCOPE_TABLES.storageQuotas} (
     subject_type text NOT NULL CHECK (subject_type IN ('user', 'workspace')),
     subject_id text NOT NULL,
     limit_bytes integer NOT NULL CHECK (limit_bytes > 0),
     consumed_bytes integer NOT NULL DEFAULT 0 CHECK (consumed_bytes >= 0),
     note_count integer NOT NULL DEFAULT 0 CHECK (note_count >= 0),
     version integer NOT NULL DEFAULT 0,
     updated_at integer NOT NULL,
     PRIMARY KEY (subject_type, subject_id)
   )`,

  `CREATE TABLE IF NOT EXISTS ${SCOPE_TABLES.llmUsages} (
     user_id text NOT NULL,
     period_year integer NOT NULL,
     period_month integer NOT NULL CHECK (period_month BETWEEN 1 AND 12),
     limit_calls integer NOT NULL CHECK (limit_calls >= 0),
     consumed_calls integer NOT NULL DEFAULT 0 CHECK (consumed_calls >= 0),
     version integer NOT NULL DEFAULT 0,
     updated_at integer NOT NULL,
     PRIMARY KEY (user_id, period_year, period_month)
   )`,

  `CREATE TABLE IF NOT EXISTS ${SCOPE_TABLES.noteSearch} (
     note_id text PRIMARY KEY,
     owner_type text NOT NULL,
     owner_id text NOT NULL,
     created_by text NOT NULL,
     title text NOT NULL,
     text text NOT NULL,
     excerpt text NOT NULL,
     tag_names text NOT NULL DEFAULT '',
     tag_display_names text NOT NULL DEFAULT '',
     visibility text NOT NULL,
     content_status text NOT NULL,
     style_mode text NOT NULL,
     has_source_file integer NOT NULL DEFAULT 0,
     lifecycle text NOT NULL,
     author_display_name text NOT NULL,
     author_handle text,
     workspace_name text,
     workspace_slug text,
     workspace_published integer NOT NULL DEFAULT 0,
     projection_revision integer NOT NULL,
     author_version integer NOT NULL,
     workspace_version integer NOT NULL DEFAULT 0,
     created_at integer NOT NULL,
     updated_at integer NOT NULL,
     trashed_at integer,
     purge_after integer
   )`,
  `CREATE INDEX IF NOT EXISTS note_search_owner_lifecycle_updated_idx
     ON ${SCOPE_TABLES.noteSearch} (owner_type, owner_id, lifecycle, updated_at DESC)`,
  `CREATE INDEX IF NOT EXISTS note_search_owner_lifecycle_created_idx
     ON ${SCOPE_TABLES.noteSearch} (owner_type, owner_id, lifecycle, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS note_search_owner_lifecycle_title_idx
     ON ${SCOPE_TABLES.noteSearch} (owner_type, owner_id, lifecycle, title)`,
  `CREATE INDEX IF NOT EXISTS note_search_created_by_note_idx
     ON ${SCOPE_TABLES.noteSearch} (created_by, note_id)`,

  `CREATE TABLE IF NOT EXISTS ${SCOPE_TABLES.noteSearchTags} (
     normalized text NOT NULL,
     note_id text NOT NULL,
     PRIMARY KEY (normalized, note_id)
   )`,
  `CREATE INDEX IF NOT EXISTS note_search_tags_note_idx
     ON ${SCOPE_TABLES.noteSearchTags} (note_id)`,

  `CREATE VIRTUAL TABLE IF NOT EXISTS ${SCOPE_TABLES.noteSearchFts} USING fts5(
     title_fts,
     text_fts,
     tag_names_fts,
     content='',
     tokenize='unicode61'
   )`,

  `CREATE TABLE IF NOT EXISTS ${SCOPE_TABLES.outboxEvents} (
     id text PRIMARY KEY,
     type text NOT NULL,
     payload text NOT NULL,
     occurred_at integer NOT NULL,
     aggregate_id text NOT NULL,
     created_at integer NOT NULL,
     attempts integer NOT NULL DEFAULT 0,
     processed_at integer,
     failed_at integer,
     next_attempt_at integer,
     claimed_at integer,
     claimed_by text,
     last_error text
   )`,
  `CREATE INDEX IF NOT EXISTS outbox_events_pending_idx
     ON ${SCOPE_TABLES.outboxEvents} (created_at, id) WHERE processed_at IS NULL`,

  `CREATE TABLE IF NOT EXISTS ${SCOPE_TABLES.processedEvents} (
     consumer text NOT NULL,
     event_id text NOT NULL,
     processed_at integer NOT NULL,
     PRIMARY KEY (consumer, event_id)
   )`,

  `CREATE TABLE IF NOT EXISTS ${SCOPE_TABLES.scheduledTasks} (
     kind text NOT NULL,
     operation_id text NOT NULL,
     due_at integer NOT NULL,
     payload text NOT NULL,
     attempts integer NOT NULL DEFAULT 0,
     last_error text,
     priority integer NOT NULL,
     status text NOT NULL CHECK (status IN ('pending', 'running', 'failed')),
     lease_expires_at integer,
     PRIMARY KEY (kind, operation_id),
     CHECK ((status = 'running') = (lease_expires_at IS NOT NULL))
   )`,
  // The three partial indexes of `spec/database/index.md#scheduled_tasks`:
  // the alarm's wake time, the dequeue walk, and the lease-expiry scan.
  // `failed` rows pile up in none of them.
  `CREATE INDEX IF NOT EXISTS scheduled_tasks_due_idx
     ON ${SCOPE_TABLES.scheduledTasks} (due_at, priority, kind, operation_id) WHERE status = 'pending'`,
  `CREATE INDEX IF NOT EXISTS scheduled_tasks_dequeue_idx
     ON ${SCOPE_TABLES.scheduledTasks} (priority, due_at, kind, operation_id) WHERE status <> 'failed'`,
  `CREATE INDEX IF NOT EXISTS scheduled_tasks_lease_idx
     ON ${SCOPE_TABLES.scheduledTasks} (lease_expires_at) WHERE status = 'running'`,

  // One table, two ports, split by the meaning of the key (ADR 045):
  // `AppliedOperationStore` folds `(operationId, commandKey)` into
  // `operation_id`, while `ScopeCleanupAdmissionStore` owns the rows with
  // `kind = 'accountDeletionBarrier'`.
  `CREATE TABLE IF NOT EXISTS ${SCOPE_TABLES.appliedOperations} (
     operation_id text PRIMARY KEY,
     kind text NOT NULL,
     result text NOT NULL,
     applied_at integer NOT NULL,
     expires_at integer
   )`,
  `CREATE INDEX IF NOT EXISTS applied_operations_expiry_idx
     ON ${SCOPE_TABLES.appliedOperations} (expires_at, operation_id) WHERE expires_at IS NOT NULL`,
];
