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
  /**
   * How many workspaces the user owns, for the ownership quota
   * (spec/usecases/workspace.md `createWorkspace` 手順 1).
   *
   * Counts `owner` edges that are `active` **or** still reserved
   * (`pending` / `activating`) — the enumeration above deliberately shows
   * only settled edges, but a quota that ignored an in-flight creation
   * would let a caller open the 21st workspace by racing its own
   * activation. A `removing` edge is not counted: its membership is being
   * torn down and the seat is already conceded.
   *
   * Counting stops at `limit`, so the answer is `min(actual, limit)` and
   * the read stays bounded whatever a shard holds. A caller comparing
   * against a ceiling passes that ceiling. `limit` is 1–100; anything
   * outside that range raises `ValidationError("INVALID_PAGINATION")`,
   * the same bounded-read contract `listActiveByUser` states for its own.
   */
  countOwnedByUser(userId: UserId, limit: number): Promise<number>;
  /**
   * How many workspaces the user still belongs to, in any role.
   *
   * Counts the **settled** edges — `active`, `pending` or `removing` —
   * which is exactly the set an account deletion fixes as membership
   * items (`AccountDeletionManifestStore.appendMembershipPage`). An
   * `activating` edge is left out for the same reason it is left out
   * there: it is still claimed by a join that has not settled, so it has
   * no settled state anything could act on. `listActiveByUser` is not a
   * substitute — it hides `pending` and `removing`, and a caller that
   * asked it instead would read zero for a user whose edges are merely
   * mid-flight.
   *
   * Counting stops at `limit`, so the answer is `min(actual, limit)` and
   * the read stays bounded whatever a shard holds; a caller that only
   * needs "any at all" passes 1. `limit` is 1–100; anything outside that
   * range raises `ValidationError("INVALID_PAGINATION")`, the same
   * bounded-read contract the other two methods state.
   */
  countSettledByUser(userId: UserId, limit: number): Promise<number>;
}
