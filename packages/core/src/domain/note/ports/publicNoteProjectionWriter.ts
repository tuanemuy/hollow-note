import type { NoteId } from "../valueObject";
import type {
  AuthorRedaction,
  NoteProjectionEntry,
  ProjectedTagName,
  ProjectionVersion,
  ProjectionWriteResult,
} from "./localNoteProjectionWriter";

/**
 * Public-projection counterpart of `LocalNoteProjectionWriter`. The
 * `routeVersion` is compared first: a greater value means the owner
 * context switched to a new generation, so the stored projection /
 * author / workspace versions are reset and the input snapshot accepted;
 * only on an equal routeVersion are the remaining vector components
 * compared. This keeps workspace→personal moves (workspaceVersion
 * dropping to 0) from becoming permanently incomparable.
 *
 * Error contract: `SystemError(DatabaseError)`. Every write may in
 * addition throw `ConflictError("OPTIMISTIC_LOCK_FAILURE")` when the row
 * moved between the read that decided the outcome and the write that
 * applies it. Only a backend that can interleave the two raises it, and
 * the redelivered event then re-reads and settles as `stale` or a no-op,
 * so the caller carries no compensation — it lets the failure reach the
 * at-least-once retry. The loss cannot be folded into a `stale` result
 * here: the contentless FTS index is undone by re-deriving the tokens of
 * the row that was read, so a writer that lost the race would retract
 * tokens the winner still owns.
 */
export interface PublicNoteProjectionWriter {
  replaceSnapshotIfNewer(
    entry: NoteProjectionEntry,
    tags: readonly ProjectedTagName[],
    version: ProjectionVersion & Readonly<{ routeVersion: number }>,
  ): Promise<ProjectionWriteResult>;
  /** Returns whether a row was removed. */
  removeIfNewer(
    noteId: NoteId,
    routeVersion: number,
    projectionRevision: number,
  ): Promise<boolean>;
  /** Public counterpart of `LocalNoteProjectionWriter.redactAuthor`. */
  redactAuthor(input: AuthorRedaction): Promise<boolean>;
  /**
   * Purge-side removal. Idempotency is satisfied by the end state — the
   * row is gone — and no acknowledgement of the operation is contracted:
   * the operation has already closed the route, so no generation is left
   * to compare and a redelivery reaches the same end state on its own.
   */
  removeForPurge(
    input: Readonly<{
      noteId: NoteId;
      operationId: string;
      routeVersion: number;
      projectionRevision: number;
    }>,
  ): Promise<void>;
}
