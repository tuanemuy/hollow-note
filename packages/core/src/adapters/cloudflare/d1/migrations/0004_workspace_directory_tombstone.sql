-- Global D1 schema, migration version 4: the `workspace_directory`
-- tombstone constraint.
--
-- `deletion_operation_id` is bound in both directions: a tombstone names
-- the deletion that made it, and that name is what `tombstone` is
-- idempotent on and what a second deletion collides with.
--
-- SQLite cannot add a CHECK in place, so the table is rebuilt. Its index
-- goes with the old table and is recreated unchanged. Rows already
-- projected as `deleting` without an operation id predate any writer, so
-- the copy derives one from the workspace id rather than dropping them: a
-- lost tombstone would resurrect a deleted workspace in every member's
-- list.

CREATE TABLE workspace_directory_v4 (
  workspace_id text PRIMARY KEY,
  name text NOT NULL,
  slug text UNIQUE,
  publication text NOT NULL CHECK (publication IN ('private', 'published')),
  lifecycle text NOT NULL CHECK (lifecycle IN ('active', 'deleting')),
  deletion_operation_id text UNIQUE,
  avatar_url text,
  source_version integer NOT NULL,
  updated_at integer NOT NULL,
  CHECK ((lifecycle = 'deleting') = (deletion_operation_id IS NOT NULL))
);

INSERT INTO workspace_directory_v4 (
  workspace_id, name, slug, publication, lifecycle, deletion_operation_id,
  avatar_url, source_version, updated_at
)
SELECT
  workspace_id, name, slug, publication, lifecycle,
  CASE
    WHEN lifecycle = 'deleting'
      THEN COALESCE(deletion_operation_id, 'legacy-tombstone:' || workspace_id)
    ELSE NULL
  END,
  avatar_url, source_version, updated_at
FROM workspace_directory;

DROP TABLE workspace_directory;

ALTER TABLE workspace_directory_v4 RENAME TO workspace_directory;

CREATE INDEX workspace_directory_public_idx
  ON workspace_directory (publication, lifecycle, updated_at DESC, workspace_id);
