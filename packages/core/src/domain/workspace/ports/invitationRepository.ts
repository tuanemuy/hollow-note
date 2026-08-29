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
 * The store applies a status predicate only in the methods that say so
 * in their name, and never an expiry one: `Invitation.isExpired` is the
 * domain's answer, evaluated against the caller's `now`, so a lapsed
 * invitation is still returned and still visible in listings (it shows as
 * `expired`, and only accepting one fails).
 *
 * The `(workspaceId, email)` "at most one pending" invariant is **not**
 * enforced here — that is why `insert` has no dedicated conflict code.
 * `inviteMember` resolves a live invitation through
 * `findPendingByWorkspaceAndEmail` and turns a second invite into a
 * resend, which is what keeps one token route per address. Enforcing it
 * in the store would mean a conflict code every backend can raise
 * identically, and the reference backend has no unique index to raise it
 * from: the same second invite would succeed on one backend and fail as
 * `SystemError(DatabaseError)` on another. Two pending invitations to
 * one address are therefore reachable when two invites race, and cost a
 * surplus token route that holds a quota slot until it lapses: the
 * second acceptance finds the membership already there and settles on
 * it rather than creating a duplicate member.
 *
 * Token routing is likewise outside this port: a token hash alone cannot
 * locate a scope, so `InvitationRouteStore.resolveActive` resolves it to
 * a workspace first and `findByTokenHash` is then read inside that scope.
 *
 * Every read observes the writes of its own unit of work except the two
 * offset listings, which answer from the last committed state — the same
 * split `MembershipRepository` draws, and for the same reason.
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
   * invitations in the workspace, not the number of pending ones. This is
   * the enumeration the deletion manifest walks; a screen that wants only
   * the outstanding ones calls `listPendingByWorkspace` instead, because
   * narrowing after the page is drawn would hide pending invitations
   * behind a page's worth of terminal ones.
   *
   * Answers from the **last committed state**: an offset page cannot be
   * recomputed from uncommitted changes without re-reading the whole
   * set, so neither this unit's inserts nor its `deleteByIds` are
   * visible here. Page it before the unit writes, or in a later one —
   * the deletion sweep does the latter, probing for leftovers in a turn
   * that deletes nothing.
   */
  listByWorkspace(
    workspaceId: WorkspaceId,
    pagination: Pagination,
  ): Promise<PaginationResult<Invitation>>;
  /**
   * The `pending` invitations of the workspace, in the same total
   * `createdAt DESC, id DESC` order as `listByWorkspace`. The narrowing
   * happens in the store, so `count` is the number of pending invitations
   * in the workspace — a page's worth of `accepted` / `revoked` rows can
   * neither empty a page nor shrink the count.
   *
   * Expiry is not a status: a lapsed invitation is still `pending` and is
   * still returned, since `Invitation.isExpired` is the domain's answer
   * against the caller's `now` and resending it is the action the screen
   * offers.
   *
   * Answers from the last committed state, on the same terms as
   * `listByWorkspace`.
   */
  listPendingByWorkspace(
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
   *
   * Unlike the two listings this observes the writes of its own unit of
   * work: the quota is decided in the transaction that issues, so a
   * number that missed the invitation the same unit has already written
   * would let the next issue past the limit.
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
