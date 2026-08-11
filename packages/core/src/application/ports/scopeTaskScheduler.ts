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
 * Claiming is a scope transaction: a scope object has a single writer,
 * so `claimDue` reads the due, non-failed rows in `dueAt` order and the
 * runner settles each one. The turn itself runs in a transaction of its
 * own (ADR-055) and settles its row there with `complete` (done),
 * `schedule` (a further page follows) or `backoffOrSchedule` (targets
 * remain but none could be processed). A turn that throws rolls its own
 * transaction back and leaves the row exactly as the claim saw it, so
 * the runner backs it off on the turn's behalf.
 *
 * `backoff` bumps `attempt` and pushes `dueAt` out exponentially
 * (`SCOPE_TASK_BACKOFF_BASE_MS` × 2^attempt, capped by
 * `SCOPE_TASK_MAX_BACKOFF_MS`) until `SCOPE_TASK_MAX_ATTEMPTS`, at which
 * point the row becomes `failed` and stops being claimed — one
 * permanently failing target must not breed continuations forever.
 * "Zero targets left" is a normal ending: it calls `complete`, not
 * `backoff`.
 *
 * `backoff` is a no-op on a row that is gone: a turn which already
 * completed its row has nothing left to retry. `backoffOrSchedule` is
 * the variant for a turn that stalls before any row exists — an
 * operation's first command arrives as an event, not as a task — where
 * a no-op would leave the retry with no driver at all.
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
  backoffOrSchedule(
    input: Readonly<{
      kind: string;
      operationId: string;
      payload: ScopeTaskPayload;
      now: Date;
    }>,
  ): Promise<void>;
}
