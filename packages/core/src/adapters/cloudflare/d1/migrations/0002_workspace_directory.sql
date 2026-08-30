-- Global D1 schema, migration version 2: `workspace_directory`.
--
-- The projection three Workspace ports read — `UserWorkspaceDirectory`
-- joins nothing but shares its page with `WorkspaceDirectoryBatchReader`,
-- and `PublicWorkspaceDirectoryReader` enumerates it for the sitemap.
-- The rows the readers see are written by
-- `WorkspaceDirectoryProjectionWriter`, called by name — synchronously by
-- the request that just committed, and by the worker half of the deletion
-- saga. No event and no subscriber drives this table. The conformance
-- suites still seed rows straight into it (`seedWorkspaceDirectory`),
-- which is the only way to pin the column combinations a writer would
-- never produce together.

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
