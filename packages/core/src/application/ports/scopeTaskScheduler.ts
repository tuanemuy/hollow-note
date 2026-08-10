export type ScopeTaskPayload = Readonly<Record<string, unknown>>;

export type ScopeTask = Readonly<{
  kind: string;
  operationId: string;
  payload: ScopeTaskPayload;
  dueAt: Date;
  /** Number of failed turns so far; `0` until the first `backoff`. */
  attempt: number;
}>;

/** First retry delay; doubled per attempt. */
export const SCOPE_TASK_BACKOFF_BASE_MS = 1_000;
/** Ceiling for one backed-off delay. */
export const SCOPE_TASK_MAX_BACKOFF_MS = 60 * 60 * 1000;
/** Attempts after which a task is parked as `failed` instead of retried. */
export const SCOPE_TASK_MAX_ATTEMPTS = 8;

/**
 * Scheduled tasks of the **current scope** — the scope-plane transport
 * for continuation requests (`storage.ownerDeleteContinued`,
 * `usage.userCleanupContinued`,
 * `identity.personalBarrierPruneContinued`, …).
 *
 * `schedule` upserts on `(kind, operationId)`, and `operationId` is
 * derived deterministically from the originating operation / event /
 * command id (spec/domains/index.md#継続要求), so replaying a turn whose
 * response was lost re-writes the same row instead of multiplying
 * continuations. Storing the next task shares the unit of work of the
 * turn it follows.
 *
 * Claiming is the enclosing scope transaction: a scope object has a
 * single writer, so `claimDue` reads the due, non-failed rows in `dueAt`
 * order and the caller settles each with `complete` (done) or `backoff`
 * (nothing could be processed while targets remain). A turn that throws
 * rolls the whole transaction back, claim included, and the row stays
 * due.
 *
 * `backoff` bumps `attempt` and pushes `dueAt` out exponentially
 * (`SCOPE_TASK_BACKOFF_BASE_MS` × 2^attempt, capped by
 * `SCOPE_TASK_MAX_BACKOFF_MS`) until `SCOPE_TASK_MAX_ATTEMPTS`, at which
 * point the row becomes `failed` and stops being claimed — one
 * permanently failing target must not breed continuations forever.
 * "Zero targets left" is a normal ending: it calls `complete`, not
 * `backoff`.
 *
 * Error contract: `SystemError(DatabaseError)`.
 */
export interface ScopeTaskScheduler {
  schedule(
    input: Readonly<{
      kind: string;
      operationId: string;
      dueAt: Date;
      payload: ScopeTaskPayload;
    }>,
  ): Promise<void>;
  claimDue(now: Date, limit: number): Promise<readonly ScopeTask[]>;
  complete(kind: string, operationId: string): Promise<void>;
  backoff(kind: string, operationId: string, now: Date): Promise<void>;
}
