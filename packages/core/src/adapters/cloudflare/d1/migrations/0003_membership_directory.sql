-- Global D1, migration version 3: the membership directory, plus the
-- corrections the distributed-operation indexes need to match their port
-- contract.
--
-- `membership_directory` is `spec/database/index.md` の「membership_directory」.
-- The Workspace domain has no ports yet, so nothing writes it in anger —
-- but `AccountDeletionManifestStore.appendMembershipPage` reads it, and a
-- backend without the table cannot verify that contract at all.
--
-- Two deliberate departures from the spec's column list, both recorded in
-- `.thread/11/adr.md`:
--
--   * `membership_id` is nullable. A `pending` edge is a reservation taken
--     before the workspace-local Membership exists, so it has no id to
--     carry yet; the CHECK still demands one from every settled edge.
--   * the keyset index is `(user_id, operation_id)`. `operation_id` is the
--     edge key an account-deletion manifest pages by, and the spec's own
--     `(user_id, state, created_at DESC, workspace_id)` index cannot serve
--     that walk.

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

-- `DistributedOperationStore` separates kinds that share a partition key:
-- `beginOrResume` starts a `noteMove` on a partition that already has a
-- running `accountDeletion`, and replays a request key per kind. Version 1
-- keyed both uniqueness rules on `partition_key` alone, which made either
-- of those a constraint violation. `spec/database/index.md#distributed_operations`
-- scopes them to the kind.

DROP INDEX distributed_operations_request_uq;
CREATE UNIQUE INDEX distributed_operations_request_uq
  ON distributed_operations (kind, partition_key, request_key);

DROP INDEX distributed_operations_active_uq;
CREATE UNIQUE INDEX distributed_operations_active_uq
  ON distributed_operations (kind, partition_key) WHERE state NOT IN ('completed', 'rejected');

DROP INDEX distributed_operations_terminal_idx;
CREATE INDEX distributed_operations_terminal_idx
  ON distributed_operations (kind, partition_key, terminal_at) WHERE terminal_at IS NOT NULL;

CREATE INDEX distributed_operations_partition_idx
  ON distributed_operations (kind, partition_key, id);
