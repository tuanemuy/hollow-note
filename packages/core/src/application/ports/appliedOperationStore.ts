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
}
