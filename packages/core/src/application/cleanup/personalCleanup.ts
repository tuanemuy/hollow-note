import type { WorkerContainer } from "../di/types";
import type { ScopeUnitOfWorkContext } from "../execution/unitOfWork";
import { ScopeTaskPriority } from "../ports/scopeTaskScheduler";
import type { ScopeKey } from "../scope";
import { REQUIRED_PERSONAL_CLEANUP_COMPONENTS } from "./participants";

/** How long a completed barrier receipt is kept before it is reclaimed. */
export const PERSONAL_BARRIER_RETENTION_MS = 120 * 24 * 60 * 60 * 1000;

/** Scope-task kind of the completed barrier's own expiry. */
export const PERSONAL_BARRIER_PRUNE_TASK_KIND =
  "identity.personalBarrierPruneContinued";

/**
 * Outcome of one personal-cleanup turn.
 *
 * `continued` means the turn re-armed its **own** scope-task row for the
 * rest of the work, so a driver that claimed that row must not settle
 * it. `stalled` means targets remain but none could be removed: the turn
 * backed its row off instead of breeding a continuation. `alreadyApplied`
 * is a redelivered command the scope had already applied.
 */
export type ScopeCleanupTurn = Readonly<{
  status: "settled" | "continued" | "stalled" | "alreadyApplied";
  /** `true` when this turn is the one that closed the barrier. */
  personalCleanupCompleted: boolean;
}>;

/**
 * Closes the personal barrier once every declared component has
 * acknowledged, and arms its expiry in the same unit of work (the store
 * must not write another port's table, so the caller pairs them).
 *
 * Returns whether the barrier is completed — including when it already
 * was, which is what lets a re-driven turn re-acknowledge the global
 * receipt without redoing the scope work.
 */
export async function completePersonalCleanupIfDone(
  ctx: ScopeUnitOfWorkContext,
  params: Readonly<{ operationId: string; now: Date }>,
): Promise<boolean> {
  const progress = await ctx.cleanupAdmission.describePersonalCleanup(
    params.operationId,
  );
  if (progress === null) {
    return false;
  }
  if (progress.status === "completed") {
    return true;
  }
  const outstanding = REQUIRED_PERSONAL_CLEANUP_COMPONENTS.some(
    (component) => !progress.acknowledged.includes(component),
  );
  if (outstanding) {
    return false;
  }

  const retainUntil = new Date(
    params.now.getTime() + PERSONAL_BARRIER_RETENTION_MS,
  );
  await ctx.cleanupAdmission.markCompleted(params.operationId, retainUntil);
  await ctx.scopeTaskScheduler.schedule({
    kind: PERSONAL_BARRIER_PRUNE_TASK_KIND,
    operationId: params.operationId,
    priority: ScopeTaskPriority.expiryCollection,
    dueAt: retainUntil,
    payload: {
      deletionOperationId: params.operationId,
      asOf: retainUntil.toISOString(),
    },
  });
  return true;
}

/** Receipts one prune turn reclaims. */
export const PERSONAL_BARRIER_PRUNE_PAGE_SIZE = 100;

/**
 * Reclaims completed barrier receipts whose retention has lapsed
 * (TC-identity-110 / 111).
 *
 * The scan is bounded and the deadline is the turn's own fixed `asOf`,
 * so a receipt that completes while the turn runs is not swept early;
 * running barriers have no expiry at all and are never candidates.
 * Reaching a short page is the proof there is nothing left, and only
 * then is the task settled — a turn whose response was lost finds the
 * row still due and repeats a scan that has nothing to remove.
 *
 * The full-page branch is unreachable on a backend that keeps at most
 * one barrier receipt per scope (the memory adapter, and what the
 * conformance suite pins today), so it is carried untested until a
 * backend that can hold several exists — #11.
 */
export async function prunePersonalCleanupBarriers(
  container: WorkerContainer,
  params: Readonly<{ scope: ScopeKey; operationId: string; asOf: Date }>,
): Promise<ScopeCleanupTurn> {
  return container.scopeUnitOfWorkProvider.run(params.scope, async (ctx) => {
    const removed = await ctx.cleanupAdmission.pruneCompleted(
      params.asOf,
      PERSONAL_BARRIER_PRUNE_PAGE_SIZE,
    );
    if (removed === PERSONAL_BARRIER_PRUNE_PAGE_SIZE) {
      await ctx.scopeTaskScheduler.schedule({
        kind: PERSONAL_BARRIER_PRUNE_TASK_KIND,
        operationId: params.operationId,
        priority: ScopeTaskPriority.expiryCollection,
        dueAt: params.asOf,
        payload: {
          deletionOperationId: params.operationId,
          asOf: params.asOf.toISOString(),
        },
      });
      return { status: "continued", personalCleanupCompleted: false };
    }
    await ctx.scopeTaskScheduler.complete(
      PERSONAL_BARRIER_PRUNE_TASK_KIND,
      params.operationId,
    );
    return { status: "settled", personalCleanupCompleted: false };
  });
}
