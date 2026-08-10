import type {
  DueScopeTask,
  ScopeTaskQueue,
} from "../../application/ports/scopeTaskQueue";
import type { MemoryBackend } from "./store";

/**
 * Scope-spanning view over the in-process scheduled-task tables. Reads
 * only: the runner claims inside each scope's own unit of work.
 */
export function createMemoryScopeTaskQueue(
  backend: MemoryBackend,
): ScopeTaskQueue {
  return {
    async listDue(now: Date, limit: number): Promise<readonly DueScopeTask[]> {
      if (limit <= 0) {
        return [];
      }
      return backend
        .scopeEntries()
        .flatMap(([, store]) =>
          store.scheduledTasks
            .values()
            .filter(
              (row) =>
                row.state === "pending" && row.dueAt.getTime() <= now.getTime(),
            )
            .map((row) => ({ scope: store.scope, row })),
        )
        .sort((a, b) => a.row.dueAt.getTime() - b.row.dueAt.getTime())
        .slice(0, limit)
        .map(({ scope, row }) => ({
          scope,
          kind: row.kind,
          operationId: row.operationId,
        }));
    },
  };
}
