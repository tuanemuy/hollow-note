import {
  type ClaimDueScopeTasksArgs,
  SCOPE_TASK_BACKOFF_BASE_MS,
  SCOPE_TASK_MAX_ATTEMPTS,
  SCOPE_TASK_MAX_BACKOFF_MS,
  type ScopeTask,
  type ScopeTaskScheduler,
} from "../../../application/ports/scopeTaskScheduler";
import { selectDueScopeTasks } from "../scopeTaskSelection";
import type { ScheduledTaskRow, ScopeStore } from "../store";
import { clone } from "../support";

// NUL separates the composite key because it cannot occur in either
// part; the escape sequence (not a raw byte) keeps this file text for
// git diff / grep / blame.
export const scopeTaskKey = (kind: string, operationId: string): string =>
  `${kind}\u0000${operationId}`;

/** A row that can be selected: pending and due, or running past its lease. */
export type DueScheduledTaskRow = Extract<ScheduledTaskRow, { dueAt: Date }>;

export const isScopeTaskDue = (
  row: ScheduledTaskRow,
  now: Date,
): row is DueScheduledTaskRow =>
  row.state === "pending"
    ? row.dueAt.getTime() <= now.getTime()
    : row.state === "running"
      ? row.leaseExpiresAt.getTime() <= now.getTime()
      : false;

export const toScopeTask = (
  row: Extract<ScheduledTaskRow, { state: "running" }>,
): ScopeTask => ({
  kind: row.kind,
  operationId: row.operationId,
  priority: row.priority,
  payload: clone(row.payload),
  dueAt: row.dueAt,
  leaseExpiresAt: row.leaseExpiresAt,
  attempt: row.attempt,
});

export const backoffDelayMs = (attempt: number): number =>
  Math.min(
    SCOPE_TASK_BACKOFF_BASE_MS * 2 ** Math.max(attempt - 1, 0),
    SCOPE_TASK_MAX_BACKOFF_MS,
  );

export function createMemoryScopeTaskScheduler(
  scope: ScopeStore,
): ScopeTaskScheduler {
  const table = scope.scheduledTasks;

  return {
    async schedule(input): Promise<void> {
      const key = scopeTaskKey(input.kind, input.operationId);
      // Upsert: a replayed turn re-writes its own row, and rescheduling
      // an exhausted task revives it as a fresh attempt.
      table.set(key, {
        kind: input.kind,
        operationId: input.operationId,
        payload: clone(input.payload),
        priority: input.priority,
        dueAt: input.dueAt,
        attempt: 0,
        state: "pending",
      });
    },

    async claimDue({
      now,
      limit,
      leaseMs,
    }: ClaimDueScopeTasksArgs): Promise<readonly ScopeTask[]> {
      const candidates = table
        .values()
        .filter((row) => isScopeTaskDue(row, now));
      const leaseExpiresAt = new Date(now.getTime() + leaseMs);
      return selectDueScopeTasks(candidates, limit).map((row) => {
        const claimed = {
          kind: row.kind,
          operationId: row.operationId,
          payload: row.payload,
          priority: row.priority,
          attempt: row.attempt,
          dueAt: row.dueAt,
          leaseExpiresAt,
          state: "running",
        } as const;
        table.set(scopeTaskKey(row.kind, row.operationId), claimed);
        return toScopeTask(claimed);
      });
    },

    async complete(kind: string, operationId: string): Promise<void> {
      table.delete(scopeTaskKey(kind, operationId));
    },

    async backoff(kind: string, operationId: string, now: Date): Promise<void> {
      const key = scopeTaskKey(kind, operationId);
      const row = table.get(key);
      if (row === undefined) {
        return;
      }
      table.set(key, backedOff(row, now));
    },

    async backoffOrSchedule(input): Promise<void> {
      const key = scopeTaskKey(input.kind, input.operationId);
      const row = table.get(key) ?? {
        kind: input.kind,
        operationId: input.operationId,
        payload: clone(input.payload),
        priority: input.priority,
        dueAt: input.now,
        attempt: 0,
        state: "pending" as const,
      };
      table.set(key, backedOff(row, input.now));
    },
  };
}

// Both branches are spelled out rather than spread over the row they
// replace: spreading survives the excess property check, so a `failed`
// row built from a `running` one would keep a lease nothing can read
// and a `dueAt` its state gives no meaning to.
const backedOff = (row: ScheduledTaskRow, now: Date): ScheduledTaskRow => {
  const attempt = row.attempt + 1;
  return attempt >= SCOPE_TASK_MAX_ATTEMPTS
    ? {
        kind: row.kind,
        operationId: row.operationId,
        payload: row.payload,
        priority: row.priority,
        attempt,
        state: "failed",
      }
    : {
        kind: row.kind,
        operationId: row.operationId,
        payload: row.payload,
        priority: row.priority,
        attempt,
        dueAt: new Date(now.getTime() + backoffDelayMs(attempt)),
        state: "pending",
      };
};
