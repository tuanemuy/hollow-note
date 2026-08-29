/**
 * Duplicate suppression for the **operation commands** delivered to the
 * current scope (account-deletion cleanup today; note move and
 * membership commands later) — `applied_operations` of
 * spec/database/index.md.
 *
 * `markApplied` records `(operationId, commandKey)` and returns `true`
 * the first time, `false` for a redelivery of the same command, so a
 * command that arrives twice is applied once and the retry resumes from
 * where the first attempt left off. The record must share the unit of
 * work of the command it guards.
 *
 * `clearApplied` removes one such record. A record asserts that the
 * command's effect **is currently in place**, so a *compensating*
 * transaction that removes the effect must remove the record with it, in
 * the same unit of work. Without that, a saga that compensates and is
 * then re-requested under the same operation id skips the command whose
 * effect the compensation had just erased. Clearing a record that was
 * never written is a no-op, which is what lets a compensation rewind a
 * scope without first asking what it managed to apply.
 *
 * Distinct from `IdempotencyStore`, which keys on `(consumer, EventId)`
 * on the global plane: the key means something different (one delivery
 * of an event vs. one command of an operation), so neither store is
 * generalized into the other.
 *
 * Error contract: `SystemError(DatabaseError)`.
 */
export interface AppliedOperationStore {
  markApplied(
    input: Readonly<{ operationId: string; commandKey: string }>,
  ): Promise<boolean>;
  clearApplied(
    input: Readonly<{ operationId: string; commandKey: string }>,
  ): Promise<void>;
}
