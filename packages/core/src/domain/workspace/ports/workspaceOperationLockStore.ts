import type { UserId } from "@repo/core/domain/identity/valueObject";
import type { WorkspaceId } from "../valueObject";

/**
 * The maintenance lanes that keep running after the Workspace row is
 * gone: reclaiming the outbox this scope deliberately outlives, the job
 * history that belongs to its requesters, and compacted tombstones.
 *
 * A closed union rather than a string, because it is an allow-list — the
 * type is what keeps `create` / `retry` / `progress` and every other lane
 * that would grow business state out of the deleted scope.
 */
export type WorkspaceMaintenanceKind =
  | "jobRetention"
  | "outboxRelay"
  | "tombstonePrune";

/**
 * Write admission for the **current workspace scope**: the move
 * authorization locks and the permanent workspace-deletion admission
 * state, held in the same scope object so a single local transaction can
 * decide both.
 *
 * Deletion is one-way and has no user-facing abort. `beginDeletion` is
 * the switch that closes the scope to ordinary mutation, and nothing
 * reopens it — a failed turn recovers forward under the same operation
 * id. That is what guarantees no new membership, invitation, note or job
 * slips in behind a manifest cursor that has already passed.
 *
 * Three assertions divide who may still write:
 * - `assertWritable` — every ordinary write command in the scope, called
 *   at the `ScopeRouter` entry point.
 * - `assertDeletionOwner` — the deletion's own continuations, the only
 *   callers allowed past a closed scope.
 * - `assertMaintenanceAllowed` — the three lanes above, which outlive the
 *   Workspace row itself.
 *
 * The admission state outlives the aggregate: after the Workspace row is
 * deleted, the deletion manifest header (and then its completed
 * tombstone) is what `assertWritable` and `assertDeletionOwner` read, so
 * a write delayed past the deletion is rejected permanently rather than
 * landing in a scope that looks empty.
 *
 * Nothing here carries a lease. A staged move lock has no expiry — its
 * row's existence *is* the lock, and only `releaseMove` clears it — and a
 * deletion never lapses back to writable.
 *
 * Error contract: `ConflictError("WORKSPACE_DELETING")` (ordinary write
 * or foreign continuation against a deleting / deleted scope),
 * `ConflictError("OPTIMISTIC_LOCK_FAILURE")` (the observed Workspace
 * version no longer holds),
 * `ConflictError("MOVE_AUTHORIZATION_LOCK_CONFLICT")` (a migration id
 * already locks a different actor), `ConflictError` (deletion already
 * terminal, unknown maintenance kind), `SystemError(DatabaseError)`.
 */
export interface WorkspaceOperationLockStore {
  /**
   * Whether any note move into or out of this scope is staged and not yet
   * settled.
   *
   * `deleteWorkspace` asks before accepting: retiring the source of a
   * move whose target is already staged would strand the staged copy.
   * The port only answers — raising
   * `ConflictError("WORKSPACE_MOVE_IN_PROGRESS")` is the usecase's, since
   * the same answer means nothing to other callers.
   *
   * A pure read that never reclaims a lock, so a move that died mid-flight
   * keeps blocking until it is completed or aborted.
   */
  hasActiveMove(): Promise<boolean>;
  /**
   * Whether a staged move lock names `userId` as its actor. Such a lock
   * pinned that member's Membership version, so demoting, removing or
   * letting the member leave while it stands would invalidate an
   * authorization the move still depends on.
   *
   * Narrower than `hasActiveMove` on purpose: moves staged by other
   * members do not constrain this one's membership. A pure read.
   */
  hasMoveConflict(userId: UserId): Promise<boolean>;
  /**
   * Stages this scope's half of a note move's authorization lock, pinning
   * the Membership version the phase re-checked against `actorUserId`.
   *
   * Called inside the phase's own local transaction — the source's freeze
   * and the target's staged import each stage one in their own scope — so
   * the lock and the rows it authorizes commit together. There is no
   * state and no expiry: the row's existence is the lock, so a move that
   * dies mid-flight keeps blocking until `releaseMove` settles it.
   *
   * Idempotent for `migrationId`: a repeat naming the same actor changes
   * nothing and succeeds, which is what lets a phase whose response was
   * lost replay under the same migration id. A repeat naming a
   * **different** actor is `ConflictError("MOVE_AUTHORIZATION_LOCK_CONFLICT")`
   * — the actor is fixed in the move's operation payload, so re-pointing
   * a live lock is a defect rather than a retry.
   *
   * Locks do not exclude each other: several migrations may hold one in
   * the same scope, and `hasActiveMove` answers for all of them. What
   * they exclude is deletion and membership mutation, which read
   * `hasActiveMove` / `hasMoveConflict` inside their own transaction — so
   * a staging that races one of those is decided by the scope object's
   * serialization, and the loser sees the winner's outcome rather than a
   * half-applied one.
   *
   * It does not consult the deletion admission itself, for the same
   * reason `beginDeletion` does not consult `hasActiveMove`: the caller
   * calls `assertWritable` in this very transaction, and only the caller
   * knows which error its phase must raise.
   */
  stageMove(
    input: Readonly<{ migrationId: string; actorUserId: UserId }>,
  ): Promise<void>;
  /**
   * Clears the lock `migrationId` staged in this scope — the target's on
   * activation after the route switch, the source's when it is retired,
   * and both scopes' on an abort before the switch.
   *
   * Unconditional and idempotent: a migration id that holds no lock here,
   * because it was already released or never staged in this scope,
   * returns normally. Both callers depend on that — activation and abort
   * are each replayed under the same migration id, and neither may fail
   * on a repeat. The id is the key, so a release can only ever reach its
   * own lock; it never inspects the actor.
   */
  releaseMove(migrationId: string): Promise<void>;
  /**
   * The switch that accepts a deletion: compare-and-set the Workspace
   * from `active` to `deleting(operationId)` on
   * `expectedWorkspaceVersion`, and create the deletion manifest header
   * as `building` — in one transaction, so a scope can never be closed
   * without a manifest to drive it, nor gain a manifest it is not closed
   * for.
   *
   * Idempotent for `operationId`: a scope already `deleting` under the
   * same operation succeeds without a second header, and the version is
   * not re-checked — it has already moved, and re-checking would make the
   * lost-response retry impossible. A scope held by a **different**
   * operation is `ConflictError("WORKSPACE_DELETING")`; a version
   * mismatch on a still-active scope is
   * `ConflictError("OPTIMISTIC_LOCK_FAILURE")`. A repeat after the
   * manifest reached its completed tombstone is a `ConflictError`: the
   * operation is terminal and must not be restarted.
   *
   * It does not consult `hasActiveMove` itself. The caller checks that in
   * the same first transaction, because the two answers must be taken
   * together and only the caller knows which error to raise.
   */
  beginDeletion(
    input: Readonly<{
      workspaceId: WorkspaceId;
      operationId: string;
      expectedWorkspaceVersion: number;
    }>,
  ): Promise<void>;
  /**
   * Admits an ordinary write. Returns normally while the scope is active;
   * throws `ConflictError("WORKSPACE_DELETING")` once the Workspace is
   * `deleting` **or** a manifest header survives it — including the
   * completed tombstone, which is retained at least as long as scope
   * routing so a write delayed past the deletion is still refused.
   *
   * Every write entry point of every domain in the scope calls it, and
   * the sagas that reserve global rows first (invite / resend / accept)
   * call it again inside their local commit, so a scope that closed in
   * between rejects the write and the reservation is abandoned.
   *
   * A pure read with no side effect; safe to call any number of times.
   */
  assertWritable(): Promise<void>;
  /**
   * Admits a deletion continuation. Returns normally only when the
   * Workspace's `deleting.operationId`, or the surviving manifest
   * header's operation id, equals `operationId`; a different id or a
   * missing one is a `ConflictError`.
   *
   * It turns false once the manifest reaches its completed tombstone,
   * which is what stops a redelivered continuation from restarting
   * cleanup on a scope that has finished being cleaned. Until then it is
   * a pure, repeatable read: every turn of the deletion re-enters through
   * it, and asking twice in one turn changes nothing.
   */
  assertDeletionOwner(operationId: string): Promise<void>;
  /**
   * Admits one of the three lanes that are allowed to keep reclaiming
   * rows after the scope is closed or gone. It is the only sanctioned way
   * past `assertWritable`, and going through it — rather than skipping
   * the check — is what keeps the allow-list auditable.
   *
   * Succeeds for the declared kinds whatever the deletion state, since
   * reclaiming is exactly what a retired scope still owes. The union type
   * is the enforcement, so a backend handed anything outside it (by a
   * caller that bypassed the type) rejects with `ConflictError` rather
   * than admitting it.
   */
  assertMaintenanceAllowed(kind: WorkspaceMaintenanceKind): Promise<void>;
}
