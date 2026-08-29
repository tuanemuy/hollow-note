import type { UserId } from "@repo/core/domain/identity/valueObject";

/**
 * Workspace-local prepare lock of the account-deletion two-phase removal
 * (`membership_removal_locks` of spec/database/index.md), bound to the
 * **current workspace scope**.
 *
 * The global deletion orchestrator takes one lock per workspace the user
 * belongs to, keeps them alive while it collects the rest, and only then
 * commits. Until every lock is `committed`, no destructive cleanup has
 * started, so a rejected prepare can still be rolled back by releasing
 * them all.
 *
 * Lease: `prepared` locks expire 10 minutes out and the orchestrator
 * renews every 2 minutes. Expiry is **fail-safe and never automatic** —
 * a lapsed lock still answers `hasConflict`, and membership mutations
 * must not decide on their own that it has gone stale. Only the global
 * recovery command resolves it: it reads the operation from the control
 * plane and issues `renew` when it is still running, `release` when it is
 * terminal. `committed` locks carry no expiry at all and are removed only
 * by completion or recovery.
 *
 * The store deliberately exposes no way to read a lease. The
 * orchestrator's "at least 5 minutes of headroom on every lock before
 * committing" rule is checked against the expiry it last wrote through
 * `prepare` / `renew`, which it knows without a round trip.
 *
 * Every method is keyed on `operationId`, so each is safe to repeat after
 * a lost response, and a lock held by a different operation is never
 * touched.
 *
 * Error contract: `ConflictError("OPTIMISTIC_LOCK_FAILURE")` (the
 * observed Membership version no longer holds, the membership being
 * locked is gone), `ConflictError` (the user is locked by another
 * operation, or the named lock does not exist), `SystemError(DatabaseError)`.
 */
export interface MembershipRemovalPreparationStore {
  /**
   * Takes the lock on this scope's Membership of `userId`, conditional on
   * `expectedMembershipVersion` still being the current one.
   *
   * The check is what makes the later commit safe: a role change or a
   * removal that lands between the orchestrator's read and this call
   * bumps the version, and the prepare fails with
   * `ConflictError("OPTIMISTIC_LOCK_FAILURE")` rather than locking a
   * membership the caller no longer understands. A membership that is
   * gone reports the same conflict — the remedy is identical, re-read and
   * re-decide.
   *
   * At most one lock exists per user in a scope. Another operation's lock
   * is a `ConflictError` **even when its lease has lapsed**, per the
   * fail-safe rule above.
   *
   * Idempotent for `operationId`: the holder re-issuing the call succeeds
   * and the lease becomes the later of the stored value and `expiresAt`,
   * so a replay can neither duplicate the lock nor shorten it. A lock
   * this operation has already committed also succeeds, without moving
   * back to `prepared`.
   */
  prepare(
    input: Readonly<{
      operationId: string;
      userId: UserId;
      expectedMembershipVersion: number;
      expiresAt: Date;
    }>,
  ): Promise<void>;
  /**
   * Extends the operation's lease while the orchestrator collects the
   * remaining scopes. The stored expiry never moves backwards, so a
   * replayed or out-of-order renewal cannot shorten a live lease.
   *
   * A lock already `committed` succeeds without effect — a renewal that
   * raced the commit must not fail the recovery loop, and a committed
   * lock has no expiry to extend. A lock that does not exist is a
   * `ConflictError`: there is nothing to keep alive, and re-creating it
   * here would skip the version check that `prepare` owes.
   */
  renew(operationId: string, expiresAt: Date): Promise<void>;
  /**
   * Moves the lock to `committed` and drops its expiry. This is the
   * point of no return: once every scope's lock is committed the
   * orchestrator starts destructive cleanup, and a committed lock never
   * lapses back.
   *
   * Idempotent: a lock already `committed` under this operation succeeds.
   * A missing lock is a `ConflictError` — committing what was never
   * prepared would claim headroom the caller never had.
   *
   * The lease is not re-checked here; the headroom rule belongs to the
   * orchestrator, which knows the expiry it last wrote.
   */
  commit(operationId: string): Promise<void>;
  /**
   * Removes the operation's lock in either state, reopening the
   * membership to mutation. It is both the rollback of a rejected prepare
   * and the completion path of a committed one — nothing else removes a
   * committed lock.
   *
   * Idempotent: a no-op when the lock is already gone, so it is safe to
   * call blindly on any failure path and safe to repeat.
   */
  release(operationId: string): Promise<void>;
  /**
   * Whether a lock exists for the user in this scope, in **either** state
   * and **including a lapsed one**. Role changes, removals, departures
   * and workspace deletion consult it and refuse while it is true.
   *
   * Answering true for a lapsed `prepared` lock is the point: the
   * orchestrator may be mid-recovery and about to renew, and letting a
   * membership mutation win on a clock reading alone would break the
   * version the lock pinned. Only `release` turns it false.
   *
   * A pure read — it never reclaims, never lapses, never mutates.
   */
  hasConflict(userId: UserId): Promise<boolean>;
}
