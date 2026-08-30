-- Global D1 schema, migration version 3: the two Workspace reservation
-- tables, plus one relaxation of `membership_directory`.
--
-- `workspace_slug_reservations` and `invitation_routes` are the global
-- halves of the two Workspace sagas: a slug and an invitation token are
-- unique service-wide, while the Workspace and the Invitation themselves
-- live in one scope object and can only see their own row. Both carry the
-- reservation state machine `spec/database/index.md` gives them, and both
-- are keyed so the row *is* the uniqueness claim.
--
-- Same conventions as `0001_global_schema.sql`: no FOREIGN KEY, instants
-- as UNIX milliseconds, enumerations as `text` with a `CHECK`.

-- `releasing` is in the CHECK because `spec/database/index.md` names it,
-- but no adapter ever writes it and none should: the slug exchange is
-- atomic (`activate` publishes the new key and frees the old one in one
-- transaction), so the state it would name is never observable. Keeping
-- it in the enumeration costs nothing and keeps the DDL readable next to
-- the canon; dropping it would make the two disagree.
CREATE TABLE workspace_slug_reservations (
  normalized_slug text PRIMARY KEY,
  workspace_id text NOT NULL,
  operation_id text NOT NULL,
  state text NOT NULL CHECK (state IN ('reserved', 'active', 'releasing')),
  expires_at integer,
  CHECK ((state = 'reserved') = (expires_at IS NOT NULL))
);

-- No index on `workspace_id`: nothing scans this table by it. Every read
-- and write fixes `normalized_slug`, which is the primary key — `release`
-- takes the slug it frees as an argument, and a caller that cannot recall
-- which key it holds names its candidates instead of asking the table
-- (`WorkspaceSlugReservationStore`). Add one only together with the
-- reverse lookup that would read it.

CREATE TABLE invitation_routes (
  token_hash text PRIMARY KEY,
  workspace_id text NOT NULL,
  invitation_id text NOT NULL,
  operation_id text NOT NULL,
  state text NOT NULL CHECK (state IN ('reserved', 'active', 'revoked')),
  expires_at integer NOT NULL,
  updated_at integer NOT NULL
);
-- No index on `invitation_id`: every predicate that mentions it also
-- fixes `token_hash`, which is the primary key, so the column is only
-- ever a check on a row already located. Deletion reaches its routes the
-- same way — the manifest fixed each `tokenHash` next to the invitation
-- id precisely so cleanup never has to search by invitation.

-- `membership_directory` is rebuilt to drop one CHECK of
-- `0001_global_schema.sql`:
--
--   CHECK (state NOT IN ('active', 'removing') OR membership_id IS NOT NULL)
--
-- `MembershipDirectoryReservationStore.activate` takes no argument beyond
-- the operation id, so it settles whatever edge the row already holds. An
-- edge that reached `pending` without a membership id therefore becomes an
-- `active` row with `membership_id IS NULL`, which the reference backend
-- accepts and this CHECK rejected. The port contract is the canon of a
-- persistence port (ADR 026), so the schema yields to it — the same
-- resolution ADR 046 applies to the FOREIGN KEYs `0001` also dropped.
--
-- SQLite cannot drop a constraint in place, so the table is rebuilt. Its
-- indexes go with the old table and are recreated unchanged.

CREATE TABLE membership_directory_v3 (
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
  CHECK ((state IN ('pending', 'activating')) = (reservation_expires_at IS NOT NULL)),
  CHECK (deletion_prepare_operation_id IS NULL OR deletion_prepare_expires_at IS NOT NULL)
);

INSERT INTO membership_directory_v3 (
  operation_id, user_id, workspace_id, membership_id, role, state,
  deletion_prepare_operation_id, deletion_prepare_expires_at,
  reservation_expires_at, created_at, updated_at
)
SELECT
  operation_id, user_id, workspace_id, membership_id, role, state,
  deletion_prepare_operation_id, deletion_prepare_expires_at,
  reservation_expires_at, created_at, updated_at
FROM membership_directory;

DROP TABLE membership_directory;

ALTER TABLE membership_directory_v3 RENAME TO membership_directory;

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
