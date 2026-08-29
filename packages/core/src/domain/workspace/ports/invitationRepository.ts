import type {
  Pagination,
  PaginationResult,
} from "@repo/core/domain/common/pagination";
import type {
  TransactionalRepository,
  Versioned,
} from "@repo/core/domain/common/transactionalRepository";
import type { Email, TokenHash } from "@repo/core/domain/identity/valueObject";
import type { Invitation } from "../invitation";
import type { InvitationId, WorkspaceId } from "../valueObject";

/**
 * OCC-enforced persistence for the `Invitation` aggregate, bound to the
 * current workspace scope. As with `MembershipRepository`, a
 * `workspaceId` parameter names the bound scope rather than selecting
 * across scopes, and a foreign id matches nothing.
 *
 * The store applies no status or expiry predicate of its own beyond the
 * one method that says so in its name: `Invitation.isExpired` is the
 * domain's answer, evaluated against the caller's `now`, so a lapsed
 * invitation is still returned and still visible in listings (it shows as
 * `expired`, and only accepting one fails).
 *
 * The `(workspaceId, email)` "at most one pending" invariant is **not**
 * enforced here — that is why `insert` has no dedicated conflict code.
 * `inviteMember` resolves a live invitation through
 * `findPendingByWorkspaceAndEmail` and turns a second invite into a
 * resend, which keeps one token route per address; a store-level unique
 * constraint would instead reject the request that the design wants to
 * succeed as a resend.
 *
 * Token routing is likewise outside this port: a token hash alone cannot
 * locate a scope, so `InvitationRouteStore.resolveActive` resolves it to
 * a workspace first and `findByTokenHash` is then read inside that scope.
 *
 * Error contract: `ConflictError("OPTIMISTIC_LOCK_FAILURE")`,
 * `SystemError(DatabaseError)`.
 */
export interface InvitationRepository
  extends TransactionalRepository<Invitation, InvitationId> {
  /**
   * The invitation holding this token hash, in whatever status it is —
   * `accepted` and `revoked` invitations resolve too, so a caller can
   * tell "this link was already used" from "this link never existed"
   * instead of collapsing both into a not-found.
   *
   * Only the hash is ever stored or compared; the plaintext token exists
   * solely in the invitation URL. After `Invitation.resend` the previous
   * hash no longer matches any row, which is what invalidates the link
   * already sent.
   */
  findByTokenHash(tokenHash: TokenHash): Promise<Versioned<Invitation> | null>;
  /**
   * The single `pending` invitation for this address, or `null`.
   * `accepted` and `revoked` rows never match — they are terminal and can
   * never return to `pending`, so an address whose past invitation was
   * revoked is invitable again.
   *
   * `email` is matched on the normalized form the `Email` value object
   * produces, so a differently-cased address resolves the same row rather
   * than issuing a second invitation the invariant forbids.
   */
  findPendingByWorkspaceAndEmail(
    workspaceId: WorkspaceId,
    email: Email,
  ): Promise<Versioned<Invitation> | null>;
  /**
   * Every invitation of the workspace regardless of status, ordered
   * `createdAt DESC, id DESC`. The `id` tiebreak makes the order total:
   * invitations issued in the same instant would otherwise be free to
   * repeat on one page and vanish from the next, and the deletion
   * manifest enumerates through this listing.
   *
   * No status filter is applied here, so `count` is the number of
   * invitations in the workspace, not the number of pending ones — the
   * caller narrows to `status === "pending"`
   * (spec/usecases/workspace.md `listPendingInvitations` step 2).
   */
  listByWorkspace(
    workspaceId: WorkspaceId,
    pagination: Pagination,
  ): Promise<PaginationResult<Invitation>>;
  /**
   * How many invitations are **currently** `pending` and were created at
   * or after `since` (the boundary is inclusive).
   *
   * Both halves are load-bearing for the issuance quota
   * (spec/usecases/workspace.md `inviteMember`): the quota counts
   * outstanding stock, so an invitation that has since been accepted or
   * revoked frees its slot immediately, and `since` bounds the window in
   * which the stock was issued. A resend does not move `createdAt`, so a
   * resent invitation keeps counting against the window it was first
   * issued in.
   *
   * This is why the port returns only a number and nothing resembling a
   * "retry at" — nothing can predict when a slot frees, which is what
   * separates the quota from a rate limit.
   */
  countPendingIssuedSince(
    workspaceId: WorkspaceId,
    since: Date,
  ): Promise<number>;
  /**
   * Deletes up to 100 invitations by id and answers how many rows this
   * call actually removed. Same contract as
   * `MembershipRepository.deleteByIds`: manifest-fixed ids, no OCC token,
   * idempotent per page, foreign ids ignored, and an input over the cap
   * raising `SystemError(DatabaseError)` as a caller programming error.
   */
  deleteByIds(ids: readonly InvitationId[]): Promise<number>;
}
