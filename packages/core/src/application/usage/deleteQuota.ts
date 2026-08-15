import { QuotaSubject } from "@repo/core/domain/usage/valueObject";
import { USAGE_USER_CLEANUP_TASK_KIND } from "../cleanup/participants";
import {
  completePersonalCleanupIfDone,
  type ScopeCleanupTurn,
} from "../cleanup/personalCleanup";
import type { WorkerContainer } from "../di/types";
import type { ScopeKey } from "../scope";

/** LLM usage months one turn removes (spec/usecases/usage.md#deletequota). */
export const LLM_USAGE_PAGE_SIZE = 100;

export type DeleteQuotaInput = Readonly<{
  deletionOperationId: string;
  scope: ScopeKey;
  /**
   * Set on the operation's initial command so a redelivery of it is
   * suppressed. Continuation turns leave it out: they are driven by the
   * scope's own task row, which cannot double up.
   */
  commandKey?: string;
}>;

export type DeleteQuotaArgs = Readonly<{
  container: WorkerContainer;
  input: DeleteQuotaInput;
}>;

/**
 * Removes a subject's usage rows on behalf of a deletion (UC-usage-007,
 * spec/usecases/usage.md#deletequota).
 *
 * Idempotent by construction: both deletes are keyed, so a second turn
 * removes nothing and reaches the same end state, and the subject is
 * never legitimately re-created afterwards. The LLM months are removed a
 * page at a time and the continuation is stored in the very transaction
 * that removed the page, so a lost response resumes from what is left
 * rather than from the beginning. Only a page below the limit — the
 * proof that nothing is left — acknowledges the `usage` component.
 *
 * A workspace subject has no LLM rows: those are billed to the user, not
 * to the workspace, so the quota row alone settles the turn.
 */
export async function deleteQuota({
  container,
  input,
}: DeleteQuotaArgs): Promise<ScopeCleanupTurn> {
  const now = container.clock.now();
  const subject =
    input.scope.type === "user"
      ? QuotaSubject.user(input.scope.userId)
      : QuotaSubject.workspace(input.scope.workspaceId);

  return container.scopeUnitOfWorkProvider.run(input.scope, async (ctx) => {
    await ctx.cleanupAdmission.assertOwner(input.deletionOperationId);
    if (
      input.commandKey !== undefined &&
      !(await ctx.appliedOperationStore.markApplied({
        operationId: input.deletionOperationId,
        commandKey: input.commandKey,
      }))
    ) {
      return { status: "alreadyApplied", personalCleanupCompleted: false };
    }

    await ctx.storageQuotaRepository.delete(subject);

    if (input.scope.type === "user") {
      const removed = await ctx.llmUsageRepository.deleteByUser(
        input.scope.userId,
        LLM_USAGE_PAGE_SIZE,
      );
      if (removed === LLM_USAGE_PAGE_SIZE) {
        await ctx.scopeTaskScheduler.schedule({
          kind: USAGE_USER_CLEANUP_TASK_KIND,
          operationId: input.deletionOperationId,
          dueAt: now,
          payload: { deletionOperationId: input.deletionOperationId },
        });
        return { status: "continued", personalCleanupCompleted: false };
      }
    }

    await ctx.cleanupAdmission.acknowledgePersonalComponent(
      input.deletionOperationId,
      "usage",
    );
    await ctx.scopeTaskScheduler.complete(
      USAGE_USER_CLEANUP_TASK_KIND,
      input.deletionOperationId,
    );
    return {
      status: "settled",
      personalCleanupCompleted: await completePersonalCleanupIfDone(ctx, {
        operationId: input.deletionOperationId,
        now,
      }),
    };
  });
}
