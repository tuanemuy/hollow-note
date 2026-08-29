import type { ShardPage } from "@repo/core/domain/common/pagination";
import type { UserId } from "@repo/core/domain/identity/valueObject";
import type { WorkspaceId, WorkspaceRole } from "../valueObject";

/**
 * One active edge of the global membership directory: the workspace the
 * user belongs to and the role the directory has projected for it.
 *
 * The role is a projection, never an authorization fact. A caller may
 * render it, but every permission decision re-reads `Membership` in the
 * workspace scope (spec/usecases/workspace.md `listUserWorkspaces`
 * step 2).
 */
export type UserWorkspaceEdge = Readonly<{
  workspaceId: WorkspaceId;
  role: WorkspaceRole;
}>;

/**
 * Keyset enumeration of the workspaces a user belongs to, read from the
 * global `membership_directory` and bound to that user's UserId shard —
 * it never scans another shard and never joins the workspace rows
 * themselves (`WorkspaceDirectoryBatchReader` resolves the page's display
 * data afterwards).
 *
 * Only `active` edges are returned. A `pending` edge belongs to a
 * membership whose scope-local commit has not landed yet, and a
 * `removing` edge is being torn down while account deletion / integration
 * cleanup still needs it to find the scope; surfacing either would show a
 * workspace the user cannot act in.
 *
 * Ordered `created_at DESC, workspace_id` — a total order that does not
 * depend on the workspace name. That is the point of the ordering: names
 * change between pages, and a name-ordered keyset would silently skip or
 * repeat rows when one does. `limit` is 1–20; anything outside that range,
 * an unreadable cursor, and a retired routing generation all raise
 * `ValidationError("INVALID_PAGINATION")`.
 *
 * The cursor is an opaque (signed) value carrying the routing generation
 * and the trailing key. It is **not authenticated**: it decides where a
 * page starts, never what it may contain, so the `userId` filter is
 * applied on every read whatever cursor arrives and no caller may treat
 * one as a capability. `nextCursor === null` means the enumeration is
 * exhausted, so a caller's `hasMore` is exactly `nextCursor !== null`.
 * During a reshard both generations are read and deduplicated by
 * `workspaceId`, the higher-version edge winning.
 *
 * Error contract: `ValidationError("INVALID_PAGINATION")`,
 * `SystemError(DatabaseError)`.
 */
export interface UserWorkspaceDirectory {
  listActiveByUser(
    userId: UserId,
    cursor: string | null,
    limit: number,
  ): Promise<ShardPage<UserWorkspaceEdge>>;
}
