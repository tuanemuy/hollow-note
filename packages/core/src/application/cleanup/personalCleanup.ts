import type { ScopeUnitOfWorkContext } from "../execution/unitOfWork";
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
 * acknowledged, and arms its expiry in the same unit of work (ADR-005:
 * the store must not write another port's table, so the caller pairs
 * them).
 *
 * Returns whether the barrier is completed — including when it already
 * was, which is what lets a re-driven turn re-acknowledge the global
 * receipt without redoing the scope work (ADR-018).
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
    dueAt: retainUntil,
    payload: {
      deletionOperationId: params.operationId,
      asOf: retainUntil.toISOString(),
    },
  });
  return true;
}
