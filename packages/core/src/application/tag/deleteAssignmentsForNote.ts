import {
  armNotePurgeContinuation,
  assertNotePurgeAdmission,
  type NotePurgeFanOutTurn,
} from "../cleanup/notePurgeFanOut";
import type { WorkerContainer } from "../di/types";
import type { ScopeKey } from "../scope";

/** Scope-task kind carrying this follower's continuation turns. */
export const NOTE_ASSIGNMENT_DELETE_TASK_KIND = "tag.noteDeleteContinued";

/** Assignments one turn reclaims (spec/usecases/tag.md#deleteassignmentsfornote). */
export const NOTE_ASSIGNMENT_DELETE_BATCH_SIZE = 200;

export type DeleteAssignmentsForNoteInput = NotePurgeFanOutTurn &
  Readonly<{
    scope: ScopeKey;
    /** The purge's operation id; keys this follower's continuation row. */
    operationId: string;
  }>;

export type DeleteAssignmentsForNoteView = Readonly<{ deletedCount: number }>;

export type DeleteAssignmentsForNoteArgs = Readonly<{
  container: WorkerContainer;
  input: DeleteAssignmentsForNoteInput;
}>;

/**
 * Drops the tag assignments of a purged note (UC-tag-013,
 * spec/usecases/tag.md#deleteassignmentsfornote).
 *
 * The tags themselves stay — a tag left with no notes is
 * `deleteUnusedTags`'s business, not this turn's — and no
 * `tag.unassigned` is emitted: the read-model rows those events project
 * into are removed by the projection writers that handle the same
 * `note.purged`, so announcing the unassignment would only race them.
 *
 * Idempotence (no `IdempotencyStore`): deleted rows do not come back, so
 * a redelivered `note.purged` answers `0` — including after the deletion
 * barrier that drove the purge has completed
 * (`assertNotePurgeAdmission`). The overlap with `deleteTagsForScope` is
 * harmless for the same reason — whichever runs second deletes nothing.
 */
export async function deleteAssignmentsForNote({
  container,
  input,
}: DeleteAssignmentsForNoteArgs): Promise<DeleteAssignmentsForNoteView> {
  const now = container.clock.now();

  return container.scopeUnitOfWorkProvider.run(input.scope, async (ctx) => {
    await assertNotePurgeAdmission(ctx, input.deletionOperationId);

    const deletedCount = await ctx.tagAssignmentRepository.deleteByNote(
      input.noteId,
      NOTE_ASSIGNMENT_DELETE_BATCH_SIZE,
    );

    if (deletedCount < NOTE_ASSIGNMENT_DELETE_BATCH_SIZE) {
      await ctx.scopeTaskScheduler.complete(
        NOTE_ASSIGNMENT_DELETE_TASK_KIND,
        input.operationId,
      );
      return { deletedCount };
    }

    await armNotePurgeContinuation(ctx, {
      kind: NOTE_ASSIGNMENT_DELETE_TASK_KIND,
      operationId: input.operationId,
      turn: input,
      now,
    });
    return { deletedCount };
  });
}
