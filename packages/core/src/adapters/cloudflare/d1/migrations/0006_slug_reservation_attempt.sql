-- Global D1 schema, migration version 6: the attempt that holds a slug
-- reservation.
--
-- `changeWorkspaceSlug` derives its operation id from `(workspaceId, slug)`
-- so that a retry after a lost response lands on the row its predecessor
-- took. The consequence is that two concurrent attempts at the same rename
-- share one row, and `operation_id` alone cannot tell them apart — a losing
-- attempt's compensation would drop the row a still-running one is about to
-- activate. `attempt_id` names the attempt that reserved the row last and is
-- what `abandon` is conditioned on.
--
-- Nullable rather than `NOT NULL DEFAULT ''`: a row written before this
-- migration was held by no attempt, and a NULL never matches an abandon,
-- which is the safe direction — the row is then left to expiry recovery
-- instead of being dropped out from under its owner.

ALTER TABLE workspace_slug_reservations ADD COLUMN attempt_id text;
