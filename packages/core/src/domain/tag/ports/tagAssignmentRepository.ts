import type { NoteId } from "@repo/core/domain/note/valueObject";
import type { TagAssignment } from "../tagAssignment";

/**
 * Assignments of the **current scope**. Bound to the scope object the
 * tagged notes live in, so a note id alone is enough to address a row
 * once the caller has resolved the scope.
 *
 * Declared here is the surface the note-purge fan-out needs
 * (`deleteAssignmentsForNote`). The lookups and bounded batches the
 * curation paths add — `findByTagAndNote`, `listByTag`, `countByNote`,
 * `deleteBatchByTag`, `deleteByScope`, `reassignBatch` — arrive with the
 * slice that owns tagging itself.
 *
 * Assignments carry no version, so there is no OCC here: `insert` is the
 * only way a row appears and `deleteByNote` the only way one leaves.
 *
 * Error contract: `ConflictError("ASSIGNMENT_ALREADY_EXISTS")`,
 * `SystemError(DatabaseError)`.
 */
export interface TagAssignmentRepository {
  /**
   * Adds one assignment. `(tagId, noteId)` is unique, so re-inserting a
   * pair that already exists raises
   * `ConflictError("ASSIGNMENT_ALREADY_EXISTS")` rather than silently
   * duplicating it.
   */
  insert(assignment: TagAssignment): Promise<void>;
  /** Every assignment of `noteId`, ordered by id. */
  listByNote(noteId: NoteId): Promise<readonly TagAssignment[]>;
  /**
   * Deletes at most `limit` assignments of `noteId` (`limit <= 0`
   * deletes nothing) and answers how many went.
   *
   * The bound is what keeps one purge turn inside its budget: a caller
   * that deletes a full page reschedules itself, and because the rows it
   * deleted cannot come back, reading from the start always moves
   * forward — no cursor is needed. A note with no assignments is not an
   * error; it answers `0`, which is what makes a redelivered
   * `note.purged` a no-op.
   */
  deleteByNote(noteId: NoteId, limit: number): Promise<number>;
}
