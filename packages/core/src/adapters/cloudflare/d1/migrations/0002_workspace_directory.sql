-- Global D1 schema, migration version 2: `workspace_directory`.
--
-- The projection three Workspace ports read — `UserWorkspaceDirectory`
-- joins nothing but shares its page with `WorkspaceDirectoryBatchReader`,
-- and `PublicWorkspaceDirectoryReader` enumerates it for the sitemap.
-- The rows the readers see are written by the `workspace.*` projection,
-- which has no port yet, so nothing in this schema version writes the
-- table; the conformance harness seeds it directly (ADR 011 of the
-- slice's work log, mirrored by `seedWorkspaceDirectory`).
--
-- Same conventions as `0001_global_schema.sql`: no FOREIGN KEY, instants
-- as UNIX milliseconds, enumerations as `text` with a `CHECK`.
--
-- `deletion_operation_id` is declared but not yet constrained to be
-- present on a `deleting` row: `spec/database/index.md#workspace_directory`
-- requires it, and the writer that would supply it arrives with the
-- projection port. Until then the column would make every tombstone
-- unrepresentable.

CREATE TABLE workspace_directory (
  workspace_id text PRIMARY KEY,
  name text NOT NULL,
  slug text UNIQUE,
  publication text NOT NULL CHECK (publication IN ('private', 'published')),
  lifecycle text NOT NULL CHECK (lifecycle IN ('active', 'deleting')),
  deletion_operation_id text UNIQUE,
  avatar_url text,
  source_version integer NOT NULL,
  updated_at integer NOT NULL,
  CHECK (lifecycle = 'deleting' OR deletion_operation_id IS NULL)
);

CREATE INDEX workspace_directory_public_idx
  ON workspace_directory (publication, lifecycle, updated_at DESC, workspace_id);
