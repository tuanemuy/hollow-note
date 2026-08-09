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
 * remote state — a different id, a missing receipt, or an uncommitted
 * one is rejected.
 *
 * `markCompleted` is only legal after every local task / event consumer
 * ack; until then the receipt has no expiry and must not be pruned.
 * Completion stores (in the same UoW) a prune task for `retainUntil`
 * (120 days), after which `pruneCompleted` reclaims at most `limit`
 * receipts per pass; late duplicate deliveries inside the retention
 * window no-op safely.
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
  acknowledgePersonalComponent(
    operationId: string,
    component: PersonalCleanupComponent,
  ): Promise<void>;
  markCompleted(operationId: string, retainUntil: Date): Promise<void>;
  pruneCompleted(asOf: Date, limit: number): Promise<number>;
}
