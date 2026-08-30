-- Global D1 schema, migration version 1.
--
-- No FOREIGN KEY declarations. The port contract is the canon of a
-- persistence port and it nowhere requires referential enforcement: the
-- conformance suites insert an `Identity` for a user row that was never
-- written, and the reference backend accepts it. A schema that enforced
-- the reference would fail suites the reference backend passes, and the
-- contract wins. The cross-row cleanup the spec calls `ON DELETE CASCADE`
-- is carried by domain events instead.

CREATE TABLE _occ_guard (
  id integer PRIMARY KEY,
  CONSTRAINT _occ_guard_conflict CHECK (id <> 0)
);

-- ---------------------------------------------------------------- Identity

CREATE TABLE users (
  id text PRIMARY KEY,
  email text,
  status text NOT NULL CHECK (status IN ('pending', 'active', 'deleting', 'deleted')),
  verified_at integer,
  display_name text,
  bio text,
  avatar_url text,
  handle text,
  auth_epoch integer NOT NULL DEFAULT 0 CHECK (auth_epoch >= 0),
  deletion_operation_id text,
  deleted_at integer,
  version integer NOT NULL DEFAULT 0,
  created_at integer NOT NULL,
  updated_at integer NOT NULL,
  CHECK (status <> 'pending' OR verified_at IS NULL),
  CHECK (status NOT IN ('active', 'deleting') OR verified_at IS NOT NULL),
  CHECK (status <> 'deleting' OR deletion_operation_id IS NOT NULL),
  CHECK (status <> 'deleted' OR (
    email IS NULL AND display_name IS NULL AND handle IS NULL
    AND verified_at IS NULL AND deletion_operation_id IS NULL
    AND deleted_at IS NOT NULL
  ))
);

CREATE TABLE identities (
  id text PRIMARY KEY,
  user_id text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('password', 'oauth')),
  password_hash text,
  provider text CHECK (provider IS NULL OR provider IN ('google')),
  provider_account_id text,
  provider_email text,
  version integer NOT NULL DEFAULT 0,
  created_at integer NOT NULL,
  updated_at integer NOT NULL,
  CHECK ((kind = 'password') = (password_hash IS NOT NULL)),
  CHECK ((kind = 'oauth') = (provider IS NOT NULL)),
  CHECK ((kind = 'oauth') = (provider_account_id IS NOT NULL)),
  CHECK ((kind = 'oauth') = (provider_email IS NOT NULL))
);

CREATE INDEX identities_user_idx ON identities (user_id);
CREATE UNIQUE INDEX identities_user_password_uq ON identities (user_id) WHERE kind = 'password';

CREATE TABLE identity_removal_receipts (
  identity_id text PRIMARY KEY,
  user_id text NOT NULL,
  operation_id text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('password', 'oauth')),
  provider_account_key text,
  expires_at integer NOT NULL,
  CHECK (kind = 'oauth' OR provider_account_key IS NULL)
);

CREATE INDEX identity_removal_receipts_operation_idx ON identity_removal_receipts (operation_id);
CREATE INDEX identity_removal_receipts_expires_idx ON identity_removal_receipts (expires_at, identity_id);

CREATE TABLE sessions (
  id text PRIMARY KEY,
  user_id text NOT NULL,
  token_hash text NOT NULL UNIQUE,
  auth_epoch integer NOT NULL,
  created_at integer NOT NULL,
  expires_at integer NOT NULL
);

CREATE INDEX sessions_user_epoch_idx ON sessions (user_id, auth_epoch, id);
CREATE INDEX sessions_expires_idx ON sessions (expires_at, id);

CREATE TABLE auth_tokens (
  id text PRIMARY KEY,
  user_id text NOT NULL,
  purpose text NOT NULL CHECK (purpose IN ('email_verification', 'password_reset')),
  token_hash text NOT NULL UNIQUE,
  auth_epoch integer NOT NULL,
  status text NOT NULL CHECK (status IN ('pending', 'consumed')),
  consumed_at integer,
  created_at integer NOT NULL,
  expires_at integer NOT NULL,
  CHECK ((status = 'consumed') = (consumed_at IS NOT NULL))
);

CREATE INDEX auth_tokens_user_purpose_idx ON auth_tokens (user_id, purpose);
CREATE INDEX auth_tokens_user_epoch_idx ON auth_tokens (user_id, auth_epoch, id);
CREATE INDEX auth_tokens_expires_idx ON auth_tokens (expires_at, id);

CREATE TABLE login_attempts (
  key text PRIMARY KEY,
  failure_count integer NOT NULL DEFAULT 0,
  last_failed_at integer,
  expires_at integer NOT NULL
);

CREATE INDEX login_attempts_expires_idx ON login_attempts (expires_at, key);

CREATE TABLE oauth_flow_states (
  state text PRIMARY KEY,
  provider text NOT NULL,
  code_verifier text NOT NULL,
  intent text NOT NULL CHECK (intent IN ('signIn', 'linkIdentity', 'integration')),
  user_id text,
  user_auth_epoch integer,
  redirect_to text,
  state_binding_hash text NOT NULL,
  created_at integer NOT NULL,
  expires_at integer NOT NULL,
  CHECK ((intent IN ('linkIdentity', 'integration')) = (user_id IS NOT NULL)),
  CHECK ((intent IN ('linkIdentity', 'integration')) = (user_auth_epoch IS NOT NULL))
);

CREATE INDEX oauth_flow_states_expires_idx ON oauth_flow_states (expires_at, state);

-- -------------------------------------------------- directory / operation

CREATE TABLE identity_unique_reservations (
  kind text NOT NULL CHECK (kind IN ('email', 'handle', 'providerAccount')),
  normalized_key text NOT NULL,
  user_id text NOT NULL,
  operation_id text NOT NULL UNIQUE,
  claim_token text NOT NULL,
  state text NOT NULL CHECK (state IN ('reserved', 'active', 'releasing')),
  expires_at integer,
  user_version integer,
  updated_at integer NOT NULL,
  PRIMARY KEY (kind, normalized_key),
  CHECK (state <> 'reserved' OR expires_at IS NOT NULL)
);

-- `membership_id` is left nullable because the CHECK below is where the
-- requirement lives and it binds settled edges only. No writer takes that
-- latitude: `reserveAndClaimActivation` supplies the id, so an edge names
-- its membership from the state it is first inserted in, and a row that
-- names none is refused by the role projection rather than projected onto.
-- `(user_id, operation_id)` exists because `operation_id` is the edge key
-- an account-deletion manifest pages by, and neither of the other two
-- indexes can walk that order.
CREATE TABLE membership_directory (
  operation_id text PRIMARY KEY,
  user_id text NOT NULL,
  workspace_id text NOT NULL,
  membership_id text,
  role text NOT NULL,
  state text NOT NULL CHECK (state IN ('pending', 'activating', 'active', 'removing')),
  deletion_prepare_operation_id text,
  deletion_prepare_expires_at integer,
  reservation_expires_at integer,
  created_at integer NOT NULL,
  updated_at integer NOT NULL,
  CHECK (state NOT IN ('active', 'removing') OR membership_id IS NOT NULL),
  CHECK ((state IN ('pending', 'activating')) = (reservation_expires_at IS NOT NULL)),
  CHECK (deletion_prepare_operation_id IS NULL OR deletion_prepare_expires_at IS NOT NULL)
);

CREATE UNIQUE INDEX membership_directory_edge_uq
  ON membership_directory (user_id, workspace_id);
CREATE INDEX membership_directory_user_edge_idx
  ON membership_directory (user_id, operation_id);
CREATE INDEX membership_directory_user_state_idx
  ON membership_directory (user_id, state, created_at DESC, workspace_id);
CREATE INDEX membership_directory_workspace_idx
  ON membership_directory (workspace_id, state, user_id);
CREATE INDEX membership_directory_recovery_idx
  ON membership_directory (reservation_expires_at, operation_id)
  WHERE state IN ('pending', 'activating');

CREATE TABLE note_routes (
  note_id text PRIMARY KEY,
  scope_type text NOT NULL CHECK (scope_type IN ('user', 'workspace')),
  scope_id text NOT NULL,
  created_by text NOT NULL,
  route_version integer NOT NULL CHECK (route_version >= 0),
  state text NOT NULL CHECK (state IN ('reserved', 'active', 'moving', 'purging', 'tombstone')),
  target_scope_type text,
  target_scope_id text,
  migration_id text,
  last_migration_id text,
  operation_id text,
  updated_at integer NOT NULL,
  reservation_expires_at integer,
  tombstone_expires_at integer,
  CHECK ((state = 'moving') = (target_scope_type IS NOT NULL)),
  CHECK ((state = 'moving') = (target_scope_id IS NOT NULL)),
  CHECK (state NOT IN ('reserved', 'moving', 'purging') OR operation_id IS NOT NULL),
  CHECK ((state = 'reserved') = (reservation_expires_at IS NOT NULL)),
  CHECK ((state = 'tombstone') = (tombstone_expires_at IS NOT NULL))
);

-- `state` is deliberately not a prefix column: the fan-out scans filter it
-- with `<> 'reserved'`, and an inequality before `note_id` would stop the
-- keyset order from coming out of the index.
CREATE INDEX note_routes_created_by_idx ON note_routes (created_by, note_id);
CREATE INDEX note_routes_scope_idx ON note_routes (scope_type, scope_id, note_id);

CREATE TABLE distributed_operations (
  id text PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN (
    'noteMove', 'notePurge', 'workspaceDeletion', 'accountDeletion',
    'membershipChange', 'nameChange', 'integrationDisconnect'
  )),
  partition_key text NOT NULL,
  request_key text NOT NULL,
  state text NOT NULL CHECK (state IN ('running', 'completed', 'rejected')),
  payload text NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at integer,
  created_at integer NOT NULL,
  updated_at integer NOT NULL,
  terminal_at integer,
  expires_at integer
);

-- Every uniqueness rule is scoped to the kind as well as the partition
-- key: `beginOrResume` starts a `noteMove` on a partition that already
-- has a running `accountDeletion`, and replays a request key per kind.
CREATE UNIQUE INDEX distributed_operations_request_uq
  ON distributed_operations (kind, partition_key, request_key);
CREATE UNIQUE INDEX distributed_operations_active_uq
  ON distributed_operations (kind, partition_key) WHERE state NOT IN ('completed', 'rejected');
CREATE INDEX distributed_operations_recovery_idx
  ON distributed_operations (next_attempt_at, id) WHERE next_attempt_at IS NOT NULL;
CREATE INDEX distributed_operations_terminal_idx
  ON distributed_operations (kind, partition_key, terminal_at) WHERE terminal_at IS NOT NULL;
CREATE INDEX distributed_operations_partition_idx
  ON distributed_operations (kind, partition_key, id);

CREATE TABLE account_deletion_manifests (
  operation_id text PRIMARY KEY,
  user_id text NOT NULL,
  status text NOT NULL CHECK (status IN (
    'building', 'built', 'rollingBack', 'completed', 'rejected'
  )),
  membership_cursor text,
  author_route_cursor text,
  receipts text NOT NULL DEFAULT '[]',
  terminal_at integer,
  retain_until integer
);

CREATE UNIQUE INDEX account_deletion_manifests_active_uq
  ON account_deletion_manifests (user_id) WHERE status NOT IN ('completed', 'rejected');
CREATE INDEX account_deletion_manifests_terminal_idx
  ON account_deletion_manifests (retain_until, operation_id)
  WHERE status IN ('completed', 'rejected');

CREATE TABLE account_deletion_manifest_items (
  operation_id text NOT NULL,
  key text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('membership', 'authorRoute')),
  workspace_id text,
  edge_state text CHECK (edge_state IS NULL OR edge_state IN ('active', 'removing', 'pending')),
  membership_id text,
  prepare_command_key text,
  prepare_dispatched_at integer,
  prepare_acked_at integer,
  release_command_key text,
  release_dispatched_at integer,
  release_acked_at integer,
  cleanup_acked_at integer,
  note_id text,
  route_version integer,
  local_redaction_acked_at integer,
  public_redaction_acked_at integer,
  PRIMARY KEY (operation_id, key),
  CHECK ((kind = 'membership') = (workspace_id IS NOT NULL)),
  CHECK ((kind = 'authorRoute') = (note_id IS NOT NULL))
);

CREATE INDEX account_deletion_manifest_items_kind_idx
  ON account_deletion_manifest_items (operation_id, kind, key);

CREATE TABLE global_maintenance_runs (
  run_id text PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('authStatePrune', 'jobTombstonePrune', 'accountManifestPrune')),
  status text NOT NULL CHECK (status IN ('running', 'completed')),
  -- Fixed when the run is created and never re-read from the deployment's
  -- configuration afterwards: a lane holds an index into this JSON array,
  -- not a table name.
  tables text NOT NULL,
  as_of integer NOT NULL,
  lease_owner text NOT NULL,
  lease_until integer NOT NULL,
  completed_at integer,
  expires_at integer
);

CREATE UNIQUE INDEX global_maintenance_runs_active_uq
  ON global_maintenance_runs (kind) WHERE status = 'running';
CREATE INDEX global_maintenance_runs_expiry_idx
  ON global_maintenance_runs (expires_at, run_id) WHERE status = 'completed';

CREATE TABLE global_maintenance_run_lanes (
  run_id text NOT NULL,
  generation text NOT NULL,
  shard_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('unclaimed', 'active', 'completed')),
  table_index integer NOT NULL,
  cursor text,
  command_key text NOT NULL,
  PRIMARY KEY (run_id, generation, shard_id)
);

CREATE INDEX global_maintenance_run_lanes_status_idx
  ON global_maintenance_run_lanes (run_id, status, generation, shard_id);

-- ------------------------------------------------------------ projection

CREATE TABLE public_note_search (
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
  route_version integer NOT NULL,
  projection_revision integer NOT NULL,
  author_version integer NOT NULL,
  workspace_version integer NOT NULL DEFAULT 0,
  created_at integer NOT NULL,
  updated_at integer NOT NULL,
  trashed_at integer,
  purge_after integer
);

CREATE INDEX public_note_search_updated_idx ON public_note_search (updated_at DESC, note_id);
CREATE INDEX public_note_search_owner_updated_idx ON public_note_search (owner_type, owner_id, updated_at DESC, note_id);
CREATE INDEX public_note_search_created_by_note_idx ON public_note_search (created_by, note_id);
CREATE INDEX public_note_search_owner_note_idx ON public_note_search (owner_type, owner_id, note_id);

CREATE TABLE public_note_search_tags (
  normalized text NOT NULL,
  note_id text NOT NULL,
  PRIMARY KEY (normalized, note_id)
);

CREATE INDEX public_note_search_tags_note_idx ON public_note_search_tags (note_id);

-- Contentless: the bigram-preprocessed text exists only inside the index,
-- and rowids are inserted explicitly from `public_note_search.rowid`.
CREATE VIRTUAL TABLE public_note_search_fts USING fts5(
  title_fts,
  text_fts,
  tag_names_fts,
  content='',
  tokenize='unicode61'
);

-- ------------------------------------------------------- infrastructure

CREATE TABLE outbox_events (
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
);

CREATE INDEX outbox_events_pending_idx
  ON outbox_events (created_at, id) WHERE processed_at IS NULL;
CREATE INDEX outbox_events_processed_idx
  ON outbox_events (processed_at) WHERE processed_at IS NOT NULL;

CREATE TABLE processed_events (
  consumer text NOT NULL,
  event_id text NOT NULL,
  processed_at integer NOT NULL,
  PRIMARY KEY (consumer, event_id)
);

-- Derived index of scope-plane work, kept because Durable Objects cannot
-- be enumerated while `ScopeTaskQueue.listDue` must span every scope.
-- The authoritative rows live in each object's
-- `scheduled_tasks`; a scope object refreshes its slice here inside the
-- same call that commits a write-set touching that table, so a task is
-- listed by the time `run` resolves. `lease_expires_at IS NULL` mirrors
-- `status = 'pending'`; `failed` rows are absent entirely.
CREATE TABLE scope_task_due_index (
  scope_type text NOT NULL CHECK (scope_type IN ('user', 'workspace')),
  scope_id text NOT NULL,
  kind text NOT NULL,
  operation_id text NOT NULL,
  due_at integer NOT NULL,
  priority integer NOT NULL,
  lease_expires_at integer,
  PRIMARY KEY (scope_type, scope_id, kind, operation_id)
);

CREATE INDEX scope_task_due_index_selection_idx
  ON scope_task_due_index (priority, due_at, kind, operation_id);
