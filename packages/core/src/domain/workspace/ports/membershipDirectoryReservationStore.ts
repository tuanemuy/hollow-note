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
 * the two planes sharing a unit of work.
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
 * Removal is the third saga and it is reversible: `beginRemoval` →
 * (workspace-local delete) → `completeRemoval`, with `abandonRemoval`
 * putting the edge back when the local delete is refused. Without that
 * last transition a removal whose second transaction lost a business rule
 * would leave the edge `removing` with no way back, and the member's
 * workspace would be gone from their list while their membership still
 * stood.
 *
 * The edge also carries the role the workspace list renders, which
 * `applyRoleIfNewer` keeps current. That one write is the port's only
 * out-of-band projection, and it is ordered by the Membership version
 * rather than by arrival.
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
   * Membership does not exist yet, and it is written whatever state the
   * edge comes to rest in — a `pending` reservation names its membership
   * no less than an `active` edge does. That is what lets `activate` need
   * no argument beyond the operation id, and what lets `applyRoleIfNewer`
   * read an edge naming no membership as one that cannot be the
   * generation a role change belongs to.
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
   * An edge an account deletion has prepared is left alone too: the
   * deletion has decided about that edge, and only `commitAccountDeletion`
   * cancels a locked one. The join has already lost its `activate` there,
   * so dropping the row would take the deletion's subject out from under
   * it and let a later join re-take the pair behind the manifest cursor.
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
   * Projects a role change onto the edge, so the workspace list shows the
   * role the scope actually holds. The edge is the only
   * place `listActiveByUser` reads a role from, so without this the list
   * keeps rendering the role the join was created with.
   *
   * `membershipId` names the generation the change belongs to and is
   * matched before anything else: the write happens only on an edge that
   * names **this** membership. A version orders changes within one
   * Membership and says nothing across two, so without the match a change
   * of a membership that was since removed would be applied to the edge a
   * rejoin created — where `sourceVersion` is `null` again, so the
   * "never projected is oldest" rule below would let it through and then
   * refuse the new membership's own first change.
   *
   * `sourceVersion` is the Membership version the change produced, and it
   * is the whole ordering within that generation: the write happens only
   * when it is **greater** than the version stored on the edge, and an
   * edge that has never been projected (its role came from the
   * reservation) is older than any of them.
   *
   * Nothing is answered. Whether this particular call was the one that
   * wrote is not knowable to every backend — a guarded UPDATE that
   * affected no row is indistinguishable from one that did where the
   * driver reports no row count — and no caller needs it: the projection
   * converges on the highest version regardless of who applied it.
   *
   * The version rule covers all three arrivals delivery can produce
   * within one generation. A redelivery of the same change repeats a
   * version that is no longer greater and writes nothing, so
   * at-least-once costs nothing. A change that arrives **after** a later
   * one — the order the outbox never promises — is refused rather than
   * rolling the role back to the value it named. Of two concurrent
   * applies the higher version wins whichever arrives second, because the
   * comparison is against the stored row rather than against what the
   * caller last read. The fourth arrival — a change that outlives the
   * membership it belongs to — is the `membershipId` match's, not this
   * rule's.
   *
   * Keyed on `(userId, workspaceId)` for the reason `beginRemoval` gives:
   * the row's operation id belongs to the join that created it, and a
   * role change cannot re-derive it. Every state takes the write — an
   * edge still `pending` / `activating` carries the reservation's role
   * until its join settles, and `activate` never revisits it, so the
   * projection has to reach it too.
   *
   * An **absent** edge is a no-op, never an insert: a role change
   * delivered after the member was removed must not resurrect the edge,
   * and the removal is what freed the `(userId, workspaceId)` pair for a
   * future join. An edge that names **another** membership is the same
   * no-op, for the same reason: the membership this change belongs to is
   * gone. So is an edge that names none at all — every reservation writes
   * its `membershipId`, so a nameless edge cannot be the generation this
   * change belongs to, and the match fails closed rather than projecting
   * onto a row it cannot identify.
   */
  applyRoleIfNewer(
    input: Readonly<{
      userId: UserId;
      workspaceId: WorkspaceId;
      membershipId: MembershipId;
      role: WorkspaceRole;
      sourceVersion: number;
    }>,
  ): Promise<void>;
  /**
   * Opens the tear-down of a settled edge: `active → removing`, before
   * the workspace-local Membership is deleted by `removeMember` /
   * `leaveWorkspace`.
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
   * record of what happened.
   *
   * An `activating` edge is taken as well. That state is what a join
   * leaves behind when its `activate` never landed, and the workspace
   * scope — which the caller has already consulted — is the authority on
   * whether the membership exists. Refusing it would strand the removal
   * instead: a member whose edge never settled could never be removed,
   * and a workspace deletion walking its manifest would park on that item
   * forever with no operator move that clears it. The join loses its
   * `activate`, which is the lesser failure, and its own compensation
   * (`abandon`) is confined to `pending` / `activating` so it cannot undo
   * the removal in turn.
   *
   * A `pending` edge is still a `ConflictError`: that is the state an
   * account deletion's prepare lock owns, and taking it would decide
   * against a deletion that has already decided about this edge.
   */
  beginRemoval(userId: UserId, workspaceId: WorkspaceId): Promise<void>;
  /**
   * Puts a `removing` edge back to `active` — the compensation for a
   * removal whose workspace-local delete never landed
   * (`application/workspace/removeMember.ts` / `leaveWorkspace.ts`).
   *
   * The guards a removal runs are evaluated twice, once before the
   * announcement and once inside the transaction that deletes the row,
   * and the second evaluation can still refuse: two concurrent removals
   * of two owners both pass the first, and only one may pass the second.
   * Without this transition the loser's edge would stay `removing`, so a
   * member who is still an owner would have lost the workspace from their
   * list with no call able to give it back.
   *
   * Idempotent by target state, like the two transitions it undoes: an
   * edge already `active` succeeds, and an **absent** one succeeds too —
   * a removal that got as far as `completeRemoval` has nothing to
   * restore. A `pending` / `activating` edge is a `ConflictError`: no
   * removal announced those, so restoring one would settle a join the
   * store never saw activate.
   */
  abandonRemoval(userId: UserId, workspaceId: WorkspaceId): Promise<void>;
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
