import type { UserId } from "@repo/core/domain/identity/valueObject";

export type PersonalCleanupComponent =
  | "job"
  | "note"
  | "tag"
  | "storage"
  | "backup"
  | "usage"
  | "localProjection"
  | "outbox";

export type PersonalCleanupProgress = Readonly<{
  status: "running" | "completed";
  acknowledged: readonly PersonalCleanupComponent[];
}>;

/**
 * Write-admission barrier bound to the **current scope**.
 *
 * `assertWritable` checks the scope-wide barrier (workspace deletion
 * state on a workspace scope, the personal account-deletion barrier
 * receipt on a personal scope) and rejects normal writes with
 * `ConflictError("ACCOUNT_DELETING")` / the workspace equivalent.
 * `assertActorWritable` additionally checks the actor's membership
 * removal prepare lock on workspace scopes. Every normal write entry
 * point of every domain calls both.
 *
 * `beginPersonalAccountDeletion` stores the barrier receipt at the
 * personal scope's serialization point: writes committed before the
 * barrier are visible to the subsequent cleanup scan, later writes are
 * rejected. The receipt records per-component acks (see
 * `PersonalCleanupComponent`); completion never depends on unrelated
 * scheduled tasks. `abortPersonalAccountDeletion` may only be called by
 * the same running owner and deletes the receipt, reopening writes.
 * `assertOwner` verifies cleanup-operation ownership without reading
 * remote state — a different id, a missing receipt, an uncommitted one,
 * or one already completed is rejected. It asks whether cleaning may
 * still proceed, so unlike the idempotent late-ack path below it turns
 * false at completion: admitting work after that would let a delivery
 * arriving past `pruneCompleted` walk the barrier back to `running`.
 *
 * `markCompleted` is only legal once every component the deployment
 * declares has acknowledged. The required set is **not** the whole enum:
 * it is supplied to the implementation by the composition root from the
 * participant registry (`application/cleanup/participants.ts`), so a
 * component nothing cleans up is never acknowledged on its behalf.
 * Until completion the receipt has no expiry and must not be pruned.
 * The **caller** stores the prune task for `retainUntil` (120 days) in
 * the same unit of work as `markCompleted` (a single-table store must
 * not write another port's table), after which
 * `pruneCompleted` reclaims at most `limit` receipts per pass.
 *
 * Late duplicate deliveries inside the retention window no-op safely:
 * `markCompleted` is idempotent for the owner it already completed, and
 * `acknowledgePersonalComponent` succeeds without effect once the
 * receipt is completed. `describePersonalCleanup` is what makes a
 * re-driven continuation cheap to settle — it says whether the barrier
 * is still running and which components have acknowledged, so a replay
 * processes only what is left, or, when it is already completed, only
 * re-acknowledges the global receipt.
 *
 * Error contract: `ConflictError` (barrier violations, foreign
 * operation), `SystemError(DatabaseError)`.
 */
export interface ScopeCleanupAdmissionStore {
  assertWritable(): Promise<void>;
  assertActorWritable(actorUserId: UserId): Promise<void>;
  beginPersonalAccountDeletion(
    operationId: string,
    userId: UserId,
  ): Promise<void>;
  abortPersonalAccountDeletion(operationId: string): Promise<void>;
  assertOwner(operationId: string): Promise<void>;
  /** `null` when no receipt exists or another operation owns the scope. */
  describePersonalCleanup(
    operationId: string,
  ): Promise<PersonalCleanupProgress | null>;
  acknowledgePersonalComponent(
    operationId: string,
    component: PersonalCleanupComponent,
  ): Promise<void>;
  markCompleted(operationId: string, retainUntil: Date): Promise<void>;
  pruneCompleted(asOf: Date, limit: number): Promise<number>;
}
