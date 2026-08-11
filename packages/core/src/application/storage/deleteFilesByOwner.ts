import { StorageOwner } from "@repo/core/domain/storage/valueObject";
import { STORAGE_OWNER_DELETE_TASK_KIND } from "../cleanup/participants";
import {
  completePersonalCleanupIfDone,
  type ScopeCleanupTurn,
} from "../cleanup/personalCleanup";
import type { WorkerContainer } from "../di/types";
import type { ScopeKey } from "../scope";
import { deleteStoredFiles } from "./deleteFiles";

/**
 * Files one turn removes. The cap is about the number of
 * `storage.fileDeleted` events a single transaction emits, not about the
 * number of queries (spec/usecases/storage.md#deletefilesbyowner).
 */
export const OWNER_DELETE_BATCH_SIZE = 100;

export type DeleteFilesByOwnerInput = Readonly<{
  deletionOperationId: string;
  scope: ScopeKey;
  batchSize?: number;
  /** Set on the operation's initial command only (see `deleteQuota`). */
  commandKey?: string;
}>;

export type DeleteFilesByOwnerArgs = Readonly<{
  container: WorkerContainer;
  input: DeleteFilesByOwnerInput;
}>;

export type DeleteFilesByOwnerView = ScopeCleanupTurn &
  Readonly<{ deletedCount: number }>;

/**
 * Removes an owner's file metadata on behalf of a deletion
 * (UC-storage-013, spec/usecases/storage.md#deletefilesbyowner).
 *
 * There is no cursor: each turn deletes what it reads, so reading from
 * the start always moves forward, and two continuations racing on the
 * same owner converge — whichever deletes a row first emits its single
 * `storage.fileDeleted`, and the other finds nothing. Purpose is not
 * filtered: everything the owner holds goes, icons and artifacts
 * included.
 *
 * "Targets remain but none could be deleted" is the one case that must
 * not breed a continuation — it would spin. The turn backs its own task
 * row off instead and leaves the retry to the schedule. Zero targets is
 * the opposite: work is finished, so the component is acknowledged.
 */
export async function deleteFilesByOwner({
  container,
  input,
}: DeleteFilesByOwnerArgs): Promise<DeleteFilesByOwnerView> {
  const batchSize = Math.min(
    Math.max(1, input.batchSize ?? OWNER_DELETE_BATCH_SIZE),
    OWNER_DELETE_BATCH_SIZE,
  );
  const owner =
    input.scope.type === "user"
      ? StorageOwner.user(input.scope.userId)
      : StorageOwner.workspace(input.scope.workspaceId);
  const now = container.clock.now();

  return container.scopeUnitOfWorkProvider.run(input.scope, async (ctx) => {
    await ctx.cleanupAdmission.assertOwner(input.deletionOperationId);
    if (
      input.commandKey !== undefined &&
      !(await ctx.appliedOperationStore.markApplied({
        operationId: input.deletionOperationId,
        commandKey: input.commandKey,
      }))
    ) {
      return {
        status: "alreadyApplied",
        personalCleanupCompleted: false,
        deletedCount: 0,
      };
    }

    const page = await ctx.storedFileRepository.listByOwner(owner, null, {
      page: 1,
      limit: batchSize,
    });
    const deletedCount = await deleteStoredFiles(
      ctx,
      page.items.map((file) => file.id),
      input.deletionOperationId,
      now,
    );

    if (page.items.length > 0 && deletedCount === 0) {
      await ctx.scopeTaskScheduler.backoff(
        STORAGE_OWNER_DELETE_TASK_KIND,
        input.deletionOperationId,
        now,
      );
      return {
        status: "stalled",
        personalCleanupCompleted: false,
        deletedCount,
      };
    }

    if (page.count > deletedCount) {
      await ctx.scopeTaskScheduler.schedule({
        kind: STORAGE_OWNER_DELETE_TASK_KIND,
        operationId: input.deletionOperationId,
        dueAt: now,
        payload: { deletionOperationId: input.deletionOperationId },
      });
      return {
        status: "continued",
        personalCleanupCompleted: false,
        deletedCount,
      };
    }

    await ctx.cleanupAdmission.acknowledgePersonalComponent(
      input.deletionOperationId,
      "storage",
    );
    await ctx.scopeTaskScheduler.complete(
      STORAGE_OWNER_DELETE_TASK_KIND,
      input.deletionOperationId,
    );
    return {
      status: "settled",
      personalCleanupCompleted: await completePersonalCleanupIfDone(ctx, {
        operationId: input.deletionOperationId,
        now,
      }),
      deletedCount,
    };
  });
}
