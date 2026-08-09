import type { EventId } from "@repo/core/domain/common/event";

/**
 * Duplicate suppression for event consumers whose effect is not
 * idempotent by nature (delivery is at-least-once). `markProcessed`
 * atomically records `(consumer, eventId)` and returns `false` when the
 * pair was already recorded — concurrent callers observe exactly one
 * `true`.
 *
 * Use it only for subscribers whose re-application is non-commutative
 * (aggregation, deltas): call it at the start of processing, and treat
 * `false` as a successful no-op. The record and the main effect must
 * share one unit of work on the same plane so neither can commit alone.
 * Intrinsically idempotent subscribers (overwrite / delete) skip this
 * store and document their idempotence basis in their usecase instead.
 *
 * Error contract: `SystemError(DatabaseError)`.
 */
export interface IdempotencyStore {
  markProcessed(consumer: string, eventId: EventId): Promise<boolean>;
}
