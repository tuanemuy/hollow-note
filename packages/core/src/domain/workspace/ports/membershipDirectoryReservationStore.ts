import type { UserId } from "@repo/core/domain/identity/valueObject";
import type { MembershipId, WorkspaceId, WorkspaceRole } from "../valueObject";

/**
 * An edge whose activation this shard has claimed but whose workspace-local
 * commit has not been reconciled yet. Account deletion enumerates these and
 * waits for each to converge before it fixes its manifest.
 */
export type ActivatingMembershipEdge = Readonly<{
  operationId: string;
  workspaceId: WorkspaceId;
}>;

/**
 * Reservation side of the global `membership_directory`, bound to the
 * **current UserId shard**. It exists so a membership can be announced to
 * the cross-user directory before the workspace scope commits it, without
 * the two planes sharing a unit of work ([ADR 023](spec/adr/023-two-plane-unit-of-work.md)).
 *
 * Join is a three-step saga per `operationId`:
 * `reserveAndClaimActivation` → workspace-local `Invitation.accept` +
 * `Membership.create` commit → `activate`. A local commit that failed
 * compensates with `abandon`. Both terminal steps are idempotent for the
 * operation, so a lost response is repaired by repeating the same call;
 * a caller that lost the response of `reserveAndClaimActivation` itself
 * repeats it, since an edge this operation already claimed answers
 * success rather than inserting a second row.
 *
 * The claim is what serializes joining against account deletion on the
 * same shard. Deletion never races an in-flight join: it first drains
 * `listActivatingByUser` to zero, and only then takes a prepare lock on
 * the `pending` edges that are left. Once a lock is held, `activate` is
 * refused; `releaseAccountDeletion` gives the edge back as `pending`, and
 * only `commitAccountDeletion` cancels it.
 *
 * The four `…AccountDeletion` methods act on **pending** edges only.
 * Settled (`active` / `removing`) edges are not their business — those
 * are torn down by `beginRemoval` / `completeRemoval`, or removed through
 * the deletion manifest and its cleanup acknowledgements.
 *
 * Leases here are fail-safe, matching `MembershipRemovalPreparationStore`:
 * a lapsed prepare lease does **not** free the edge for another deletion.
 * Only the holder's `renewAccountDeletion` / `releaseAccountDeletion` /
 * `commitAccountDeletion` move it, and global recovery is what decides
 * which of the three to issue. A renewal never shortens a live lease, so
 * an out-of-order replay of a renewal is harmless.
 *
 * Error contract: `ConflictError("MEMBERSHIP_ALREADY_EXISTS")` when the
 * `(userId, workspaceId)` pair is already held by another operation,
 * `ConflictError` (the user is not active, an activation refused under a
 * deletion lock, a foreign lock owner), `SystemError(DatabaseError)`.
 */
export interface MembershipDirectoryReservationStore {
  /**
   * Inserts the `pending` edge, checks that this shard's User is active,
   * and claims the edge as `activating` — in one transaction. A User that
   * is deleting leaves **no row at all**: the insert rolls back with the
   * check, so a join cannot slip an edge in behind a deletion's manifest
   * cursor.
   *
   * Idempotent for `operationId`: an edge this operation already claimed
   * or activated answers success without a second row. An edge for the
   * same `(userId, workspaceId)` held by another operation — in any state —
   * is `ConflictError("MEMBERSHIP_ALREADY_EXISTS")`, which is how two
   * concurrent accepts of one invitation resolve to a single membership.
   *
   * A pending edge already carrying a deletion prepare owner is a
   * `ConflictError`: the deletion decided about that edge, and the join
   * must lose.
   *
   * `membershipId` is carried from here even though the workspace-local
   * Membership does not exist yet, so that `activate` needs no argument
   * beyond the operation id and a settled edge always names its
   * membership.
   */
  reserveAndClaimActivation(
    input: Readonly<{
      operationId: string;
      userId: UserId;
      workspaceId: WorkspaceId;
      membershipId: MembershipId;
      role: WorkspaceRole;
      expiresAt: Date;
    }>,
  ): Promise<void>;
  /**
   * Settles the operation's `activating` edge as `active` after the
   * workspace-local commit landed.
   *
   * Idempotent: an edge already `active` under this operation succeeds,
   * so the lost-response retry cannot create a second membership. An edge
   * that is absent (`abandon` already ran) or that a deletion has since
   * locked is a `ConflictError` — the deletion wins, and the join's
   * recovery converges the edge to `abandoned` instead.
   */
  activate(operationId: string): Promise<void>;
  /**
   * Compensation for a local commit that did not land: drops the
   * operation's `pending` / `activating` edge and leaves the invitation
   * pending.
   *
   * Never touches an `active` or `removing` edge, so abandoning a join
   * whose activation actually succeeded cannot revoke a real membership.
   * A no-op when there is nothing to drop, hence safe to call blindly on
   * any failure path and safe to repeat.
   */
  abandon(operationId: string): Promise<void>;
  /**
   * Takes the account-deletion prepare lock on the `pending` edge named
   * by `edgeOperationId`, with a lease expiring at `expiresAt`. After
   * this, `activate` for that edge is refused.
   *
   * Idempotent for the `(edgeOperationId, deletionOperationId)` pair: the
   * holder re-issuing the call succeeds and the lease becomes the later
   * of the stored value and `expiresAt`. A lock held by a **different**
   * deletion is a `ConflictError` even when its lease has lapsed —
   * expiry alone never transfers ownership. An edge that is absent or not
   * `pending` is a `ConflictError`; the deletion re-reads and re-decides.
   */
  prepareAccountDeletion(
    input: Readonly<{
      edgeOperationId: string;
      deletionOperationId: string;
      expiresAt: Date;
    }>,
  ): Promise<void>;
  /**
   * Extends the holder's lease. The stored expiry never moves backwards —
   * it becomes the later of the two — so a replayed or out-of-order
   * renewal cannot shorten a live lease.
   *
   * A lock held by another deletion, or an edge with no lock, is a
   * `ConflictError`: there is nothing this deletion may renew, and
   * silently re-taking the lock would defeat the fail-safe rule above.
   */
  renewAccountDeletion(
    edgeOperationId: string,
    deletionOperationId: string,
    expiresAt: Date,
  ): Promise<void>;
  /**
   * Cancels the prepared edge — the only transition that removes it.
   *
   * Idempotent: an edge that is already gone succeeds, since a lost
   * response leaves the caller unable to tell its own commit from a
   * replay and the outcome it wants (no edge) already holds. A lock held
   * by another deletion is a `ConflictError`.
   */
  commitAccountDeletion(
    edgeOperationId: string,
    deletionOperationId: string,
  ): Promise<void>;
  /**
   * Rollback of a prepare: drops the lock and leaves the edge `pending`,
   * so the join saga that reserved it may activate again.
   *
   * Idempotent: an edge with no lock succeeds. A lock held by another
   * deletion is a `ConflictError`.
   */
  releaseAccountDeletion(
    edgeOperationId: string,
    deletionOperationId: string,
  ): Promise<void>;
  /**
   * Bounded enumeration of the shard's `activating` edges in edge-key
   * (`operationId`) order, at most `limit` per call.
   *
   * A pure read with no claim and no lease, called in a loop until it
   * returns nothing: an account deletion may only fix its manifest once
   * every in-flight join has converged to `active` or been abandoned, and
   * repeating the read is how it waits. Since every entry is settled by
   * its own saga (or by expiry recovery reconciling the edge against the
   * workspace-local Membership of the same operation), the loop
   * terminates without this port forcing anything.
   */
  listActivatingByUser(
    userId: UserId,
    limit: number,
  ): Promise<readonly ActivatingMembershipEdge[]>;
  /**
   * Opens the tear-down of a settled edge: `active → removing`, before
   * the workspace-local Membership is deleted
   * (spec/usecases/workspace.md `removeMember` 手順 5 /
   * `leaveWorkspace` 手順 4).
   *
   * A `removing` edge leaves `listActiveByUser` at once — the workspace
   * stops appearing in the member's list the moment the removal is
   * announced — while account deletion and integration cleanup can still
   * find the scope through it. That is why the edge is not simply
   * dropped here.
   *
   * Keyed on `(userId, workspaceId)` rather than on an operation id: the
   * row's own operation id belongs to the join that created it, and a
   * removal cannot re-derive it. Idempotency is therefore by target
   * state — an edge already `removing` succeeds, so a lost response is
   * repaired by repeating the call, and two concurrent removals of one
   * membership both succeed on the same row.
   *
   * An **absent** edge succeeds too: the outcome the caller wants (no
   * active edge) already holds, and the workspace-local Membership is the
   * record of what happened. A `pending` / `activating` edge is a
   * `ConflictError` — that pair is a join in flight, not a settled
   * membership, and stealing it would strand the join saga.
   */
  beginRemoval(userId: UserId, workspaceId: WorkspaceId): Promise<void>;
  /**
   * Drops the `removing` edge, after the residue cleanup of the removed
   * member has been acknowledged.
   *
   * Idempotent by end state: an edge that is already gone succeeds, since
   * a lost response leaves the caller unable to tell its own commit from
   * a replay and the outcome it wants already holds.
   *
   * An edge that is still `active` is a `ConflictError`: only the
   * `removing` phase makes the tear-down visible to the cleanup that has
   * to run before the edge disappears, so deleting one that never entered
   * it would drop the last pointer to the scope while residue is still
   * there. A `pending` / `activating` edge conflicts for the reason
   * `beginRemoval` gives.
   */
  completeRemoval(userId: UserId, workspaceId: WorkspaceId): Promise<void>;
}
