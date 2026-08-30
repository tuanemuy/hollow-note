import {
  STORAGE_OWNER_DELETE_TASK_KIND,
  USAGE_USER_CLEANUP_TASK_KIND,
} from "../cleanup/participants";
import {
  PERSONAL_BARRIER_PRUNE_TASK_KIND,
  prunePersonalCleanupBarriers,
} from "../cleanup/personalCleanup";
import type { WorkerContainer } from "../di/types";
import { isConflictError } from "../errors";
import { acknowledgePersonalCleanup } from "../identity/deleteAccount/cleanupDispatch";
import {
  SCOPE_TASK_LEASE_MS,
  type ScopeTask,
  ScopeTaskPriority,
} from "../ports/scopeTaskScheduler";
import { ScopeKey } from "../scope";
import { deleteFilesByOwner } from "../storage/deleteFilesByOwner";
import { deleteQuota } from "../usage/deleteQuota";
import {
  continueRemovalEdgeSettlement,
  MEMBERSHIP_REMOVAL_EDGE_TASK_KIND,
} from "../workspace/membershipMutation";
import {
  WORKSPACE_DELETION_COMPACT_TASK_KIND,
  WORKSPACE_DELETION_GLOBAL_TASK_KIND,
  WORKSPACE_DELETION_LOCAL_TASK_KIND,
} from "../workspace/workspaceDeletion";
import {
  compactWorkspaceDeletionManifest,
  continueWorkspaceDeletionGlobalCleanup,
} from "../workspace/workspaceDeletionGlobal";
import { continueWorkspaceDeletionLocal } from "../workspace/workspaceDeletionLocal";

/** Due rows one tick takes on. */
export const SCOPE_TASK_TICK_LIMIT = 100;

/** A claimed row together with the scope whose transaction claimed it. */
export type ClaimedScopeTask = ScopeTask & Readonly<{ scope: ScopeKey }>;

export type ScopeTaskHandler = (
  container: WorkerContainer,
  task: ClaimedScopeTask,
) => Promise<void>;

/** Scope-task kind of the hand-over that follows a closed barrier. */
export const PERSONAL_CLEANUP_HANDOVER_TASK_KIND =
  "identity.personalCleanupHandoverContinued";

/**
 * A cleanup turn settles its own task row, so the runner only re-invokes
 * the usecase. What it does have to carry across is the scope→global
 * hand-over: the barrier can only close on the turn that acknowledges
 * the last component, and nothing on the scope plane can write the
 * manifest receipt that follows it.
 *
 * That receipt is a second commit on the other plane, and by the time it
 * is attempted the turn's own row is gone — while re-running the cleanup
 * usecase can no longer stand in for it either, because `assertOwner`
 * rejects the barrier the turn just closed. So the hand-over is armed as
 * a row of its own **before** it is attempted and removed only once the
 * receipt is in: a hand-over lost to an exception or to the process
 * dying is then re-driven by the next tick instead of leaving the
 * deletion `running` with nothing left to drive it.
 */
const settleCleanupTurn = async (
  container: WorkerContainer,
  task: ClaimedScopeTask,
  turn: Readonly<{ personalCleanupCompleted: boolean }>,
): Promise<void> => {
  if (!turn.personalCleanupCompleted) {
    return;
  }
  await container.scopeUnitOfWorkProvider.run(task.scope, (ctx) =>
    ctx.scopeTaskScheduler.schedule({
      kind: PERSONAL_CLEANUP_HANDOVER_TASK_KIND,
      operationId: task.operationId,
      priority: ScopeTaskPriority.securityCleanup,
      dueAt: container.clock.now(),
      payload: { deletionOperationId: task.operationId },
    }),
  );
  await handOverPersonalCleanup(container, task);
};

const handOverPersonalCleanup: ScopeTaskHandler = async (container, task) => {
  await acknowledgePersonalCleanup(container, task.operationId);
  await container.scopeUnitOfWorkProvider.run(task.scope, (ctx) =>
    ctx.scopeTaskScheduler.complete(
      PERSONAL_CLEANUP_HANDOVER_TASK_KIND,
      task.operationId,
    ),
  );
};

/**
 * Continuation kinds this deployment knows how to resume. A task whose
 * kind is absent is left due and reported — better a visible stall than
 * a silently completed row nothing processed. The claim that read it
 * still took a lease, so the report repeats a lease apart and its
 * frequency is no measure of the stall; the line carries the row's
 * `dueAt` instead, which reclaiming a lapsed lease leaves where it was,
 * so how far past its time the row has drifted reads off the report.
 */
export const scopeTaskHandlers: Readonly<Record<string, ScopeTaskHandler>> = {
  [STORAGE_OWNER_DELETE_TASK_KIND]: async (container, task) => {
    const turn = await deleteFilesByOwner({
      container,
      input: { deletionOperationId: task.operationId, scope: task.scope },
    });
    await settleCleanupTurn(container, task, turn);
  },
  [USAGE_USER_CLEANUP_TASK_KIND]: async (container, task) => {
    const turn = await deleteQuota({
      container,
      input: { deletionOperationId: task.operationId, scope: task.scope },
    });
    await settleCleanupTurn(container, task, turn);
  },
  [PERSONAL_CLEANUP_HANDOVER_TASK_KIND]: handOverPersonalCleanup,
  // The workspace deletion settles its own rows: every turn either
  // re-arms the row it was claimed for or completes it, in the same
  // transaction as the work it did.
  [WORKSPACE_DELETION_LOCAL_TASK_KIND]: (container, task) =>
    continueWorkspaceDeletionLocal(container, {
      scope: task.scope,
      payload: task.payload,
    }),
  [WORKSPACE_DELETION_GLOBAL_TASK_KIND]: (container, task) =>
    continueWorkspaceDeletionGlobalCleanup(container, {
      scope: task.scope,
      payload: task.payload,
    }),
  [WORKSPACE_DELETION_COMPACT_TASK_KIND]: (container, task) =>
    compactWorkspaceDeletionManifest(container, {
      scope: task.scope,
      payload: task.payload,
    }),
  // The removal settles its own row too: the turn drops the directory
  // edge and completes the row only once nothing is left to drop.
  [MEMBERSHIP_REMOVAL_EDGE_TASK_KIND]: (container, task) =>
    continueRemovalEdgeSettlement(container, {
      scope: task.scope,
      payload: task.payload,
    }),
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
  /**
   * Claim lease for this round. Must outlast the whole claimed batch —
   * see `ScopeTaskScheduler` for what happens when it does not.
   */
  leaseMs?: number;
}>;

/**
 * Drives one round of the scope plane's continuation work.
 *
 * The enumeration is central because nothing else can list scopes, but
 * the rows a scope hands out are read under that scope's own
 * transaction, which is what the port means by claiming. The turn that
 * follows opens a transaction of its own and settles its row there, so a
 * turn that throws leaves the row untouched — the runner is then the
 * only one left to back it off, and without that a permanently failing
 * target would be re-driven every tick with `attempt` frozen at zero.
 *
 * One failing task must not hold up the others, so each is isolated. A
 * scope whose claim lost its race to another writer is isolated the same
 * way: that loss reaches a staged backend only at commit, so the adapter
 * cannot answer it as an empty batch, and the rows it names belong to the
 * writer that won them. Only that one failure — the `claimDue` contract's
 * `OPTIMISTIC_LOCK_FAILURE` — is skipped, since skipping is safe solely
 * because the rows have a winner; any other conflict is a fault whose
 * scope would otherwise stall behind a warning every round.
 */
export async function runDueScopeTasks(
  container: WorkerContainer,
  options: RunDueScopeTasksOptions = {},
): Promise<Readonly<{ processed: number }>> {
  const handlers = options.handlers ?? scopeTaskHandlers;
  const leaseMs = options.leaseMs ?? SCOPE_TASK_LEASE_MS;
  const now = container.clock.now();
  let budget = options.limit ?? SCOPE_TASK_TICK_LIMIT;
  const due = await container.scopeTaskQueue.listDue(now, budget);

  let processed = 0;
  const claimedScopes = new Set<string>();
  for (const row of due) {
    if (budget <= 0) break;
    const scopeKey = ScopeKey.serialize(row.scope);
    if (claimedScopes.has(scopeKey)) continue;
    claimedScopes.add(scopeKey);

    // Claiming at most the remaining budget is what keeps every claimed
    // row visited in this round: a row claimed and left over is locked
    // for the whole lease, not until the next tick.
    let claimed: readonly ScopeTask[];
    try {
      claimed = await container.scopeUnitOfWorkProvider.run(row.scope, (ctx) =>
        ctx.scopeTaskScheduler.claimDue({ now, limit: budget, leaseMs }),
      );
    } catch (cause) {
      if (!isConflictError(cause) || cause.code !== "OPTIMISTIC_LOCK_FAILURE") {
        throw cause;
      }
      container.logger.warn(
        "[scope-tasks] claim lost the race; leaving the scope to its winner",
        { cause, scope: scopeKey },
      );
      continue;
    }
    for (const task of claimed) {
      budget -= 1;
      const handle = handlers[task.kind];
      if (handle === undefined) {
        container.logger.warn(
          `[scope-tasks] no handler for ${task.kind}; leaving it due`,
          {
            kind: task.kind,
            operationId: task.operationId,
            dueAt: task.dueAt,
          },
        );
        continue;
      }
      try {
        await handle(container, { ...task, scope: row.scope });
        processed += 1;
      } catch (cause) {
        container.logger.error("[scope-tasks] task threw", {
          cause,
          kind: task.kind,
          operationId: task.operationId,
        });
        await backOff(container, row.scope, task, now);
      }
    }
  }
  return { processed };
}

const backOff = async (
  container: WorkerContainer,
  scope: ScopeKey,
  task: ScopeTask,
  now: Date,
): Promise<void> => {
  try {
    await container.scopeUnitOfWorkProvider.run(scope, (ctx) =>
      ctx.scopeTaskScheduler.backoff(task.kind, task.operationId, now),
    );
  } catch (cause) {
    container.logger.error("[scope-tasks] backoff failed", {
      cause,
      kind: task.kind,
      operationId: task.operationId,
    });
  }
};
