export type ScopeTaskPayload = Readonly<Record<string, unknown>>;

/**
 * Scheduling classes of `spec/database/index.md#scheduled_tasks`. Lower
 * runs first.
 */
export const ScopeTaskPriority = {
  /** Membership / account security cleanup, lease reaping. */
  securityCleanup: 0,
  outboxRelay: 1,
  projection: 2,
  expiryCollection: 3,
} as const;

export type ScopeTaskPriority =
  (typeof ScopeTaskPriority)[keyof typeof ScopeTaskPriority];

export type ScopeTask = Readonly<{
  kind: string;
  operationId: string;
  priority: ScopeTaskPriority;
  payload: ScopeTaskPayload;
  /** When the row is meant to run; unchanged across claims. */
  dueAt: Date;
  /** Deadline of this claim; past it, another writer may take the row. */
  leaseExpiresAt: Date;
  /** Number of failed turns so far; `0` until the first `backoff`. */
  attempt: number;
}>;

export type ClaimDueScopeTasksArgs = Readonly<{
  now: Date;
  limit: number;
  leaseMs: number;
}>;

/** First retry delay; doubled per attempt. */
export const SCOPE_TASK_BACKOFF_BASE_MS = 1_000;
/** Ceiling for one backed-off delay. */
export const SCOPE_TASK_MAX_BACKOFF_MS = 60 * 60 * 1000;
/** Attempts after which a task is parked as `failed` instead of retried. */
export const SCOPE_TASK_MAX_ATTEMPTS = 8;
/** Default claim lease, matching the outbox relay's own default. */
export const SCOPE_TASK_LEASE_MS = 5 * 60 * 1000;

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
 * Claiming takes a lease rather than trusting a scope to have a single
 * writer: `claimDue` marks each row it hands out `running` with
 * `leaseExpiresAt = now + leaseMs`, and no reader sees that row again
 * until the deadline is reached. A writer that disappears mid-turn is
 * therefore recovered — the next claim past the lease reclaims the row.
 *
 * Selection is the same rule for `claimDue` and
 * `ScopeTaskQueue.listDue`. Candidates are the rows that are `pending`
 * with `dueAt <= now` or `running` with `leaseExpiresAt <= now`. From
 * those:
 *
 * 1. Reservation — walking `priority` ascending, take the one candidate
 *    of each priority whose `(dueAt, kind, operationId)` is smallest,
 *    until the budget runs out.
 * 2. Fill — take the remaining candidates in
 *    `(priority, dueAt, kind, operationId)` order until the budget runs
 *    out.
 *
 * The result is returned in `(priority, dueAt, kind, operationId)`
 * order. Reserving one slot per priority is a floor, not a ceiling: a
 * single priority takes the whole `limit` when no other has candidates,
 * and a `limit` below the number of candidate priorities cuts step 1
 * short, degrading to strict priority order.
 *
 * `dueAt` means "when this is meant to run" whatever the state, so the
 * transitions are:
 *
 * | operation | from | to |
 * | --- | --- | --- |
 * | `schedule` | absent / pending / running / failed | pending, `dueAt = input.dueAt`, `attempt = 0`, `priority = input.priority`, lease released |
 * | `claimDue` | pending (due) / running (lapsed lease) | running, `leaseExpiresAt = now + leaseMs`; `dueAt`, `attempt` and `priority` unchanged |
 * | `complete` | any, including absent | row removed |
 * | `backoff` | pending / running / failed | pending, `attempt + 1`, `dueAt = now + delay`, lease released, `priority` unchanged — `failed` once `attempt` reaches `SCOPE_TASK_MAX_ATTEMPTS`, and a row already `failed` stays `failed` with its `attempt` still climbing past the ceiling. No-op on an absent row |
 * | `backoffOrSchedule` | absent / pending / running / failed | mints the row with `input.priority` and `dueAt = input.now` when absent, then backs off as above. An **existing** row keeps its `priority` |
 *
 * Only `schedule` brings a `failed` row back, and it resets `attempt` to
 * `0`; nothing else claims a `failed` row, so the climbing `attempt` is
 * never observable. Reclaiming a lapsed lease spends no attempt and
 * leaves `dueAt` where it was, so a reclaimed row keeps its place within
 * its priority and a row nothing settles keeps ageing — which is what an
 * oldest-task-age alert has to measure.
 *
 * `backoff` bumps `attempt` and pushes `dueAt` out exponentially
 * (`SCOPE_TASK_BACKOFF_BASE_MS` × 2^(attempt - 1) — so the first retry
 * waits `SCOPE_TASK_BACKOFF_BASE_MS` — capped by
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
 * a no-op would leave the retry with no driver at all. Neither variant
 * recovers a turn that crashes **after** its row was completed: reviving
 * the row would re-enter the usecase body, and a usecase whose barrier
 * the completed turn already closed is refused by its own `assertOwner`,
 * so the revived row only burns its attempts. Work that must survive
 * that window needs a driver of its own — a separate task row armed
 * before the step it drives, settled once the step is observable.
 *
 * The lease is advisory: settling addresses a row by
 * `(kind, operationId)` alone and carries no fencing token, so a writer
 * that overruns its lease can settle the row a second writer has since
 * re-armed. `leaseMs` is the deployment's to choose and must exceed the
 * worst-case turn — the whole claimed batch, not one row. Choosing it
 * too small breaks the continuation chain: the overrunning writer
 * completes what its successor armed, and a personal cleanup that loses
 * its chain leaves the account `deleting` for good, the reference
 * runtime having no recovery cron. That runtime chooses the value with
 * the `SCOPE_TASK_LEASE_MS` environment variable, defaulting to the
 * constant of the same name.
 *
 * Input bounds: `limit <= 0` returns an empty array, and `leaseMs` must
 * be positive — zero or less hands out a lease that has already lapsed,
 * so the same round can claim one row twice.
 *
 * Error contract: `SystemError(DatabaseError)`.
 */
export interface ScopeTaskScheduler {
  schedule(
    input: Readonly<{
      kind: string;
      operationId: string;
      priority: ScopeTaskPriority;
      dueAt: Date;
      payload: ScopeTaskPayload;
    }>,
  ): Promise<void>;
  claimDue(args: ClaimDueScopeTasksArgs): Promise<readonly ScopeTask[]>;
  complete(kind: string, operationId: string): Promise<void>;
  backoff(kind: string, operationId: string, now: Date): Promise<void>;
  backoffOrSchedule(
    input: Readonly<{
      kind: string;
      operationId: string;
      priority: ScopeTaskPriority;
      payload: ScopeTaskPayload;
      now: Date;
    }>,
  ): Promise<void>;
}
