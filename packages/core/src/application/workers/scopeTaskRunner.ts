import {
  STORAGE_OWNER_DELETE_TASK_KIND,
  USAGE_USER_CLEANUP_TASK_KIND,
} from "../cleanup/participants";
import {
  PERSONAL_BARRIER_PRUNE_TASK_KIND,
  prunePersonalCleanupBarriers,
} from "../cleanup/personalCleanup";
import type { WorkerContainer } from "../di/types";
import { acknowledgePersonalCleanup } from "../identity/deleteAccount/cleanupDispatch";
import type { DueScopeTask } from "../ports/scopeTaskQueue";
import { deleteFilesByOwner } from "../storage/deleteFilesByOwner";
import { deleteQuota } from "../usage/deleteQuota";

/** Due rows one tick takes on. */
export const SCOPE_TASK_TICK_LIMIT = 100;

export type ScopeTaskHandler = (
  container: WorkerContainer,
  task: DueScopeTask,
) => Promise<void>;

/**
 * A cleanup turn settles its own task row (ADR-055), so the runner only
 * re-invokes the usecase. What it does have to carry across is the
 * scope→global hand-over: the barrier can only close on the turn that
 * acknowledges the last component, and nothing on the scope plane can
 * write the manifest receipt that follows it.
 */
const settleCleanupTurn = async (
  container: WorkerContainer,
  operationId: string,
  turn: Readonly<{ personalCleanupCompleted: boolean }>,
): Promise<void> => {
  if (turn.personalCleanupCompleted) {
    await acknowledgePersonalCleanup(container, operationId);
  }
};

/**
 * Continuation kinds this deployment knows how to resume. A task whose
 * kind is absent is left due and reported — better a visible stall than
 * a silently completed row nothing processed.
 */
export const scopeTaskHandlers: Readonly<Record<string, ScopeTaskHandler>> = {
  [STORAGE_OWNER_DELETE_TASK_KIND]: async (container, task) => {
    const turn = await deleteFilesByOwner({
      container,
      input: { deletionOperationId: task.operationId, scope: task.scope },
    });
    await settleCleanupTurn(container, task.operationId, turn);
  },
  [USAGE_USER_CLEANUP_TASK_KIND]: async (container, task) => {
    const turn = await deleteQuota({
      container,
      input: { deletionOperationId: task.operationId, scope: task.scope },
    });
    await settleCleanupTurn(container, task.operationId, turn);
  },
  [PERSONAL_BARRIER_PRUNE_TASK_KIND]: async (container, task) => {
    await prunePersonalCleanupBarriers(container, {
      scope: task.scope,
      operationId: task.operationId,
      asOf: container.clock.now(),
    });
  },
};

export type RunDueScopeTasksOptions = Readonly<{
  limit?: number;
  handlers?: Readonly<Record<string, ScopeTaskHandler>>;
}>;

/**
 * Drives one round of the scope plane's continuation work.
 *
 * The enumeration is central because nothing else can list scopes, but
 * the claim is not: each turn opens its own scope unit of work and
 * settles its row there, which keeps the single-writer rule of a scope
 * object intact (ADR-005 / ADR-055).
 *
 * One failing task must not hold up the others, so each is isolated —
 * the row stays due and its own backoff decides when it is tried again.
 */
export async function runDueScopeTasks(
  container: WorkerContainer,
  options: RunDueScopeTasksOptions = {},
): Promise<Readonly<{ processed: number }>> {
  const handlers = options.handlers ?? scopeTaskHandlers;
  const due = await container.scopeTaskQueue.listDue(
    container.clock.now(),
    options.limit ?? SCOPE_TASK_TICK_LIMIT,
  );

  let processed = 0;
  for (const task of due) {
    const handle = handlers[task.kind];
    if (handle === undefined) {
      container.logger.warn(
        `[scope-tasks] no handler for ${task.kind}; leaving it due`,
        { kind: task.kind, operationId: task.operationId },
      );
      continue;
    }
    try {
      await handle(container, task);
      processed += 1;
    } catch (cause) {
      container.logger.error("[scope-tasks] task threw", {
        cause,
        kind: task.kind,
        operationId: task.operationId,
      });
    }
  }
  return { processed };
}
