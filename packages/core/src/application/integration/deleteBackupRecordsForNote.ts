import {
  armNotePurgeContinuation,
  assertNotePurgeAdmission,
  type NotePurgeFanOutTurn,
} from "../cleanup/notePurgeFanOut";
import type { WorkerContainer } from "../di/types";
import type { ScopeKey } from "../scope";

/** Scope-task kind carrying this follower's continuation turns. */
export const NOTE_BACKUP_DELETE_TASK_KIND = "integration.noteDeleteContinued";

/** Records one turn reclaims (spec/usecases/integration.md#deletebackuprecordsfornote). */
export const NOTE_BACKUP_DELETE_BATCH_SIZE = 100;

export type DeleteBackupRecordsForNoteInput = NotePurgeFanOutTurn &
  Readonly<{
    scope: ScopeKey;
    /** The purge's operation id; keys this follower's continuation row. */
    operationId: string;
  }>;

export type DeleteBackupRecordsForNoteView = Readonly<{
  deletedCount: number;
}>;

export type DeleteBackupRecordsForNoteArgs = Readonly<{
  container: WorkerContainer;
  input: DeleteBackupRecordsForNoteInput;
}>;

/**
 * Drops the backup records of a purged note (UC-integration-013,
 * spec/usecases/integration.md#deletebackuprecordsfornote).
 *
 * The copies in Drive are left alone: they sit in the recording user's
 * own account and what becomes of them is theirs to decide (IN-09). That
 * is also why ownership is not a filter here — a workspace note's
 * records may name several members, and all of them describe a note that
 * no longer exists.
 *
 * Idempotence (no `IdempotencyStore`): deleted rows do not come back, so
 * a redelivered `note.purged` answers `0` — including after the deletion
 * barrier that drove the purge has completed
 * (`assertNotePurgeAdmission`).
 */
export async function deleteBackupRecordsForNote({
  container,
  input,
}: DeleteBackupRecordsForNoteArgs): Promise<DeleteBackupRecordsForNoteView> {
  const now = container.clock.now();

  return container.scopeUnitOfWorkProvider.run(input.scope, async (ctx) => {
    await assertNotePurgeAdmission(ctx, input.deletionOperationId);

    const deletedCount = await ctx.backupRecordRepository.deleteByNote(
      input.noteId,
      NOTE_BACKUP_DELETE_BATCH_SIZE,
    );

    if (deletedCount < NOTE_BACKUP_DELETE_BATCH_SIZE) {
      await ctx.scopeTaskScheduler.complete(
        NOTE_BACKUP_DELETE_TASK_KIND,
        input.operationId,
      );
      return { deletedCount };
    }

    await armNotePurgeContinuation(ctx, {
      kind: NOTE_BACKUP_DELETE_TASK_KIND,
      operationId: input.operationId,
      turn: input,
      now,
    });
    return { deletedCount };
  });
}
