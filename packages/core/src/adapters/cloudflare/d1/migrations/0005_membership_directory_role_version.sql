-- Global D1 schema, migration version 5: the source version of the role
-- an edge of `membership_directory` projects.
--
-- `MembershipDirectoryReservationStore.applyRoleIfNewer` projects
-- `workspace.membership.roleChanged` onto the edge, and delivery is
-- at-least-once with no ordering guarantee. The column is what orders the
-- applies: a change writes only when the Membership version it carries is
-- greater than the stored one, so a redelivery writes nothing and a change
-- that arrives after a later one cannot roll the role back.
--
-- NULL means the role is still the one the join's reservation carried,
-- which is older than any Membership version — hence a nullable column and
-- no backfill. Adding one is the one schema change SQLite makes in place,
-- so unlike `0003` / `0004` this migration rebuilds nothing.
--
-- Same conventions as `0001_global_schema.sql`: no FOREIGN KEY, instants
-- as UNIX milliseconds, enumerations as `text` with a `CHECK`.

ALTER TABLE membership_directory ADD COLUMN role_source_version integer;
