import type {
  DueScopeTask,
  ScopeTaskQueue,
} from "../../application/ports/scopeTaskQueue";
import { isScopeTaskDue } from "./repositories/scopeTaskScheduler";
import { selectDueScopeTasks } from "./scopeTaskSelection";
import type { MemoryBackend } from "./store";

/**
 * Scope-spanning view over the in-process scheduled-task tables. Reads
 * only: the runner claims inside each scope's own unit of work, so the
 * same selection rule runs here without taking a lease.
 */
export function createMemoryScopeTaskQueue(
  backend: MemoryBackend,
): ScopeTaskQueue {
  return {
    async listDue(now: Date, limit: number): Promise<readonly DueScopeTask[]> {
      const candidates = backend.scopeEntries().flatMap(([, store]) =>
        store.scheduledTasks
          .values()
          .filter((row) => isScopeTaskDue(row, now))
          .map((row) => ({
            scope: store.scope,
            kind: row.kind,
            operationId: row.operationId,
            priority: row.priority,
            dueAt: row.dueAt,
          })),
      );
      return selectDueScopeTasks(candidates, limit).map(
        ({ scope, kind, operationId }) => ({ scope, kind, operationId }),
      );
    },
  };
}
