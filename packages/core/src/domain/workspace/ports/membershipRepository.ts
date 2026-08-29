import type {
  Pagination,
  PaginationResult,
} from "@repo/core/domain/common/pagination";
import type {
  TransactionalRepository,
  Versioned,
} from "@repo/core/domain/common/transactionalRepository";
import type { UserId } from "@repo/core/domain/identity/valueObject";
import type { Membership } from "../membership";
import type { MembershipId, WorkspaceId, WorkspaceRole } from "../valueObject";

/**
 * OCC-enforced persistence for the `Membership` aggregate, bound to the
 * current workspace scope. The `workspaceId` parameters name that scope
 * rather than select across scopes: a foreign id matches nothing (no
 * member, an empty page, a count of zero), so no read can reach another
 * workspace's members.
 *
 * This is the authorization source of truth. The global
 * `membership_directory` projects roles for listing purposes only, and
 * every permission decision resolves the role through this repository
 * (spec/domains/workspace.md#ドメインイベント).
 *
 * `insert` enforces the `(workspaceId, userId)` uniqueness invariant —
 * the aggregate cannot see its siblings, so the store is the only place
 * that can — and raises `ConflictError("MEMBERSHIP_ALREADY_EXISTS")` when
 * the pair is already taken. This is what makes a replayed
 * `acceptInvitation` safe to detect rather than silently duplicate.
 *
 * Error contract: `ConflictError("OPTIMISTIC_LOCK_FAILURE")`,
 * `ConflictError("MEMBERSHIP_ALREADY_EXISTS")`,
 * `SystemError(DatabaseError)`.
 */
export interface MembershipRepository
  extends TransactionalRepository<Membership, MembershipId> {
  /**
   * The membership of one user in this workspace, or `null` when the user
   * is not a member (which is how "no role" is expressed — there is no
   * empty-role membership).
   *
   * Returns `Versioned` rather than the bare aggregate because the
   * callers that ask this question — role changes, removal, access
   * resolution that goes on to write — need the OCC token they would
   * otherwise have to re-derive through `findById`.
   */
  findByWorkspaceAndUser(
    workspaceId: WorkspaceId,
    userId: UserId,
  ): Promise<Versioned<Membership> | null>;
  /**
   * Ordered `joinedAt ASC, id ASC`. The `id` tiebreak is what makes the
   * order total: offset paging over a partial order lets a row repeat on
   * one page and vanish from the next, and the deletion manifest
   * enumerates through this listing, so a dropped row would leave a
   * membership behind forever.
   *
   * `PaginationResult` (not a bare array) because `count` is the
   * workspace's member total — the member-count display and the manifest's
   * progress both read it from here rather than counting a page.
   *
   * The one read of this contract that does **not** observe its own
   * transaction: an offset page cannot be recomputed from uncommitted
   * changes without re-reading the whole set, so it answers from the
   * **last committed state** — neither this unit's inserts nor its
   * `deleteByIds` are visible here. That is the answer on every backend,
   * not a licence for one that buffers its writes: a read whose verdict
   * depended on how the backend stages would make the deletion sweep
   * terminate on one and loop on another. Call it before the transaction
   * writes, or in a later one — the sweep does the latter, probing for
   * leftovers in a turn that deletes nothing.
   */
  listByWorkspace(
    workspaceId: WorkspaceId,
    pagination: Pagination,
  ): Promise<PaginationResult<Membership>>;
  /**
   * Exact number of members currently holding `role` — never an estimate
   * or a cached projection.
   *
   * The last-owner invariant rests on it, so the count must be read in
   * the same transaction as the change it guards
   * (spec/usecases/workspace.md `deleteMembershipsForUser` step 2); a
   * value read outside that transaction can go stale between the check
   * and the write and let the final owner leave.
   */
  countByRole(workspaceId: WorkspaceId, role: WorkspaceRole): Promise<number>;
  /**
   * Deletes up to 100 memberships by id and answers how many rows this
   * call actually removed.
   *
   * No OCC token is threaded, unlike `delete`. The ids come from the
   * deletion manifest, which fixed them before the sweep began, and the
   * sweep recovers forward only: a version check would make a concurrent
   * role change turn a retryable page into a permanently failing one.
   *
   * Idempotent per page — ids that are already gone are skipped rather
   * than raising, so replaying the same page after a lost response
   * succeeds and simply returns a smaller number. Ids that do not belong
   * to the bound scope are ignored for the same reason a foreign
   * `workspaceId` matches nothing.
   *
   * An input over the 100-id cap raises `SystemError(DatabaseError)` — a
   * caller programming error rather than a concurrent-state conflict
   * (same contract as the batch readers' caps).
   */
  deleteByIds(ids: readonly MembershipId[]): Promise<number>;
}
