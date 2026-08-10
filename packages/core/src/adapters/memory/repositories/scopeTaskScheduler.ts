import {
  SCOPE_TASK_BACKOFF_BASE_MS,
  SCOPE_TASK_MAX_ATTEMPTS,
  SCOPE_TASK_MAX_BACKOFF_MS,
  type ScopeTask,
  type ScopeTaskScheduler,
} from "../../../application/ports/scopeTaskScheduler";
import type { ScheduledTaskRow, ScopeStore } from "../store";
import { clone, compareStrings } from "../support";

// NUL separates the composite key because it cannot occur in either
// part; the escape sequence (not a raw byte) keeps this file text for
// git diff / grep / blame.
export const scopeTaskKey = (kind: string, operationId: string): string =>
  `${kind}\u0000${operationId}`;

export const toScopeTask = (row: ScheduledTaskRow): ScopeTask => ({
  kind: row.kind,
  operationId: row.operationId,
  payload: clone(row.payload),
  dueAt: row.dueAt,
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
        dueAt: input.dueAt,
        attempt: 0,
        state: "pending",
      });
    },

    async claimDue(now: Date, limit: number): Promise<readonly ScopeTask[]> {
      if (limit <= 0) {
        return [];
      }
      return table
        .values()
        .filter(
          (row) =>
            row.state === "pending" && row.dueAt.getTime() <= now.getTime(),
        )
        .sort(
          (a, b) =>
            a.dueAt.getTime() - b.dueAt.getTime() ||
            compareStrings(
              scopeTaskKey(a.kind, a.operationId),
              scopeTaskKey(b.kind, b.operationId),
            ),
        )
        .slice(0, limit)
        .map(toScopeTask);
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
      const attempt = row.attempt + 1;
      if (attempt >= SCOPE_TASK_MAX_ATTEMPTS) {
        table.set(key, { ...row, attempt, state: "failed" });
        return;
      }
      table.set(key, {
        ...row,
        attempt,
        dueAt: new Date(now.getTime() + backoffDelayMs(attempt)),
      });
    },
  };
}
