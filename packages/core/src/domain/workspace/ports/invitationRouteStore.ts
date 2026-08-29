import type { TokenHash } from "@repo/core/domain/identity/valueObject";
import type { InvitationId, WorkspaceId } from "../valueObject";

/**
 * Where an active invitation token leads. The workspace scope holds the
 * Invitation itself; the route carries only the entry point.
 */
export type InvitationRouteTarget = Readonly<{
  workspaceId: WorkspaceId;
  invitationId: InvitationId;
}>;

/**
 * Global routing table from an invitation token hash to the workspace
 * scope that owns the invitation (`invitation_routes` of
 * spec/database/index.md). The token hash is the row's primary key, so
 * the table doubles as the token's global uniqueness reservation.
 *
 * Issue is a two-phase saga: `reserve` writes the row `reserved` for an
 * operation, the workspace-local `Invitation.issue` commits, and
 * `activate` flips the same operation's row to `active`. A local commit
 * that failed compensates with `abandon`; a lost `activate` response is
 * repaired by re-issuing `activate` under the same `operationId`. Resend
 * is the paired form: `reserveReplacement` takes the new token while the
 * old one keeps resolving, and `activateReplacement` closes the old row
 * and opens the new one in one transaction, so no window exists in which
 * both or neither token resolves.
 *
 * Closing a route is one-way. `revoke` (the invitation was cancelled) and
 * `consume` (it was accepted) are separate methods because the sagas that
 * call them are different and a conformance suite must be able to name
 * which one closed a route, but they reach the same terminal state, so a
 * route already closed by either accepts a retry of the other and
 * succeeds. Nothing moves a closed route back to `active` — a duplicate
 * `activate` arriving after `consume` must not resurrect a token that has
 * already been redeemed.
 *
 * The `expiresAt` a caller passes to `reserve` is the row's single
 * expiry, and it serves both phases: before activation it bounds the
 * reservation so an orphaned row is reclaimable, after activation it is
 * the invitation's own expiry. Callers therefore pass the invitation's
 * `expiresAt` rather than a short reservation TTL, and expiry-driven
 * recovery reconciles a `reserved` row against the workspace-local
 * Invitation of the same operation.
 *
 * Expiry is read-permissive and write-refusing. An `active` row keeps
 * resolving past its expiry, because the route is only the entry point:
 * the workspace-local Invitation is what an expired link has to be
 * judged against, and a route that stopped resolving would collapse
 * "expired" into "never existed" — `getInvitationPreview` could not
 * answer `expired` and `acceptInvitation` could not raise
 * `InvitationExpired` (spec/testcases/workspace/). A `reserved` row past
 * its expiry is the opposite case: the reservation lapsed, so `activate`
 * refuses it and recovery must `abandon` instead. Nothing turns an
 * expired token into a live one.
 *
 * Idempotency is keyed on `(tokenHash, operationId)` throughout: every
 * method may be re-issued any number of times for the same operation and
 * converges on the same row. A row held by a **different** operation is
 * never touched.
 *
 * Error contract: `ConflictError` (state-machine violation, foreign
 * operation, or a token hash already held by another operation),
 * `SystemError(DatabaseError)`.
 */
export interface InvitationRouteStore {
  /**
   * The only externally readable form: rows in the `active` state,
   * whether or not their `expiresAt` has passed. `reserved` (issue in
   * flight) and closed rows resolve to `null` and are indistinguishable
   * to the caller, which is what lets preview / accept answer
   * `INVITATION_NOT_FOUND` uniformly for a token that never opened or
   * has already been redeemed.
   *
   * An expired route still resolves so that the Invitation in the target
   * scope can be read and reported as expired; the route carries no
   * verdict of its own.
   *
   * A pure read — it never lapses a row or collects an expired one.
   */
  resolveActive(tokenHash: TokenHash): Promise<InvitationRouteTarget | null>;
  /**
   * Claims the token hash as `reserved` for `operationId`, before the
   * workspace-local `Invitation.issue` commits.
   *
   * Idempotent for the same `(tokenHash, operationId)`: a row this
   * operation already reserved, activated, or closed answers success
   * without moving, so a lost response is repaired by repeating the call.
   * A row held by another operation — in any state — is a
   * `ConflictError`, which is also how a token-hash collision surfaces.
   */
  reserve(
    input: Readonly<{
      tokenHash: TokenHash;
      workspaceId: WorkspaceId;
      invitationId: InvitationId;
      operationId: string;
      expiresAt: Date;
    }>,
  ): Promise<void>;
  /**
   * Flips this operation's `reserved` row to `active` after the local
   * commit landed.
   *
   * Idempotent: a row already `active` under the same operation succeeds.
   * A row this operation has since closed (`revoke` / `consume` ran
   * first) also succeeds **without reopening it** — forward recovery must
   * never hand a redeemed token back out. A row that is absent (an
   * `abandon` already ran) or held by another operation is a
   * `ConflictError`.
   *
   * A `reserved` row whose `expiresAt` has passed is a `ConflictError`
   * too: the reservation lapsed, and activating it would publish a token
   * that is expired the instant it becomes resolvable. Recovery
   * `abandon`s such a row instead.
   */
  activate(
    input: Readonly<{ tokenHash: TokenHash; operationId: string }>,
  ): Promise<void>;
  /**
   * Reserves `newTokenHash` for a resend while `oldTokenHash` keeps
   * resolving, so the link already in the recipient's inbox stays valid
   * until the replacement is activated.
   *
   * Verifies that the old route is `active` and points at the same
   * `invitationId`; an old route that is absent, closed, or bound to
   * another invitation is a `ConflictError`, so a resend cannot be built
   * on a route that a revoke has already closed.
   *
   * Idempotent for the same `(newTokenHash, operationId)`.
   */
  reserveReplacement(
    input: Readonly<{
      oldTokenHash: TokenHash;
      newTokenHash: TokenHash;
      workspaceId: WorkspaceId;
      invitationId: InvitationId;
      operationId: string;
      expiresAt: Date;
    }>,
  ): Promise<void>;
  /**
   * Closes the old route and opens the new one in a single transaction,
   * after the local `Invitation.resend` commits. The exchange is atomic
   * because a partial application would either leave two live tokens for
   * one invitation or none at all.
   *
   * Idempotent: once applied, a repeat observes the new row `active` and
   * the old one closed under the same operation and succeeds.
   *
   * A replacement this operation reserved but a `revoke` has since closed
   * can no longer be opened — nothing moves a closed route back. The
   * exchange still closes `oldTokenHash` while it is `active` for the
   * same invitation, and only then succeeds: an `active` row carries
   * neither an expiry nor a reclaimer, so leaving it open would keep a
   * live token resolving to an invitation that was cancelled, with no
   * call able to take it back. An old route bound to another invitation
   * is left alone.
   *
   * Concurrent resends of one invitation each reserve their own new
   * token; the first exchange wins, and the loser finds its
   * `oldTokenHash` no longer `active` and gets a `ConflictError`. The
   * loser is then responsible for `abandon`ing the replacement it
   * reserved.
   */
  activateReplacement(
    input: Readonly<{
      oldTokenHash: TokenHash;
      newTokenHash: TokenHash;
      invitationId: InvitationId;
      operationId: string;
    }>,
  ): Promise<void>;
  /**
   * Compensation for a local commit that did not land: drops the
   * operation's `reserved` row.
   *
   * Only `reserved` rows are dropped, and only this operation's — an
   * `active` or closed row is left untouched, so abandoning an issue
   * whose activation actually succeeded cannot revoke a live invitation.
   * A no-op when there is nothing to drop, so it is safe to call blindly
   * on any failure path and safe to repeat.
   */
  abandon(
    input: Readonly<{ tokenHash: TokenHash; operationId: string }>,
  ): Promise<void>;
  /**
   * Closes the route because the invitation was cancelled.
   *
   * The condition is `(tokenHash, invitationId)`, not the operation id:
   * `revokeInvitation` mints a fresh operation id per attempt and cannot
   * re-derive the one that opened the route. `operationId` is recorded
   * for audit and to make a same-operation retry recognizable.
   *
   * Idempotent by target state rather than by operation: a route already
   * closed — by this call, by another revoke, or by `consume` — succeeds.
   * An absent row succeeds too, because the route's only obligation is to
   * stop resolving and it already does not; the workspace-local
   * Invitation is the record of what happened. A row bound to a different
   * `invitationId` is a `ConflictError`.
   */
  revoke(
    input: Readonly<{
      tokenHash: TokenHash;
      invitationId: InvitationId;
      operationId: string;
    }>,
  ): Promise<void>;
  /**
   * Closes the route because the invitation was accepted. Same condition
   * and same idempotency as `revoke` — a route already closed succeeds,
   * an absent row succeeds, a foreign `invitationId` conflicts.
   *
   * `acceptInvitation` calls it after the local commit, so losing the
   * response leaves an accepted invitation with a still-live token; the
   * saga repairs that by repeating the call, which is why "already
   * closed" must not be an error.
   */
  consume(
    input: Readonly<{
      tokenHash: TokenHash;
      invitationId: InvitationId;
      operationId: string;
    }>,
  ): Promise<void>;
}
