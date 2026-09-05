import {
  assertNotePurgeAdmission,
  type NotePurgeFanOutTurn,
  settleNotePurgeTurn,
} from "../cleanup/notePurgeFanOut";
import type { WorkerContainer } from "../di/types";
import type { ScopeKey } from "../scope";
import { deleteStoredFiles } from "./deleteFiles";

/** Scope-task kind carrying this follower's continuation turns. */
export const NOTE_FILE_DELETE_TASK_KIND = "storage.noteDeleteContinued";

/**
 * Rows one turn reclaims. The cap is about the number of
 * `storage.fileDeleted` events a single transaction emits, not about the
 * number of queries (spec/usecases/storage.md#deletefilesfornote).
 */
export const NOTE_FILE_DELETE_BATCH_SIZE = 100;

export type DeleteFilesForNoteInput = NotePurgeFanOutTurn &
  Readonly<{
    scope: ScopeKey;
    /** The purge's operation id; keys this follower's continuation row. */
    operationId: string;
  }>;

export type DeleteFilesForNoteView = Readonly<{ deletedCount: number }>;

export type DeleteFilesForNoteArgs = Readonly<{
  container: WorkerContainer;
  input: DeleteFilesForNoteInput;
}>;

/**
 * Reclaims the files a purged note owned (UC-storage-012,
 * spec/usecases/storage.md#deletefilesfornote).
 *
 * Only `source` / `media` / `reference` go: an `artifact` is a
 * by-product with an expiry of its own, and an avatar belongs to no
 * note. The objects themselves follow through `storage.fileDeleted`, so
 * this turn writes metadata only.
 *
 * The second half of the spec's completion condition — reclaiming the
 * reference import records and summaries of the same note
 * (spec/usecases/storage.md#deletefilesfornote step 3) — is **not**
 * here: `ReferenceImportRecordRepository` and the tables behind it
 * arrive with the import slice, which adds its page to this same
 * continuation. Until then the file set alone decides when the turn
 * completes.
 *
 * Idempotence (no `IdempotencyStore`): deleted rows do not come back in
 * `listDeletableByNote`, so a redelivered `note.purged` finds nothing
 * and answers `0` — including after the deletion barrier that drove the
 * purge has completed (`assertNotePurgeAdmission`).
 */
export async function deleteFilesForNote({
  container,
  input,
}: DeleteFilesForNoteArgs): Promise<DeleteFilesForNoteView> {
  const now = container.clock.now();

  return container.scopeUnitOfWorkProvider.run(input.scope, async (ctx) => {
    await assertNotePurgeAdmission(ctx, input.deletionOperationId);

    const files = await ctx.storedFileRepository.listDeletableByNote(
      input.noteId,
      NOTE_FILE_DELETE_BATCH_SIZE,
    );
    const deletedCount = await deleteStoredFiles(
      ctx,
      files.map((file) => file.id),
      input.deletionOperationId,
      now,
    );

    // The page that decides the turn is what `listDeletableByNote`
    // returned, not what `deleteStoredFiles` removed: a file another
    // turn already took shortens the count without shortening the page.
    await settleNotePurgeTurn(ctx, {
      kind: NOTE_FILE_DELETE_TASK_KIND,
      operationId: input.operationId,
      turn: input,
      now,
      full: files.length >= NOTE_FILE_DELETE_BATCH_SIZE,
    });
    return { deletedCount };
  });
}
