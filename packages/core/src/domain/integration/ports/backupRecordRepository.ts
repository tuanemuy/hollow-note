import type { NoteId } from "@repo/core/domain/note/valueObject";
import type { BackupRecord } from "../backupRecord";

/**
 * Backup records of the **current scope**. The rows live in the scope
 * object of the note they describe, never in the recording user's own
 * scope, so `deleteByUser` is deliberately absent here as well as in the
 * spec: an account deletion sends a command to each scope its directory
 * lists instead of reaching across scopes.
 *
 * Declared here is the surface the note-purge fan-out needs
 * (`deleteBackupRecordsForNote`). The OCC half of the aggregate
 * (`findById` / `save` / `delete`) and `findByNoteAndFile` /
 * `listByNotes` arrive with the slice that records backups.
 *
 * Deleting a record never touches the file in the user's Drive: the copy
 * is theirs and its fate is theirs (IN-09).
 *
 * Error contract: `SystemError(DatabaseError)`.
 */
export interface BackupRecordRepository {
  /**
   * Adds one record. `(noteId, sourceFileId)` is unique, so recording
   * the same source file twice raises
   * `ConflictError("BACKUP_RECORD_ALREADY_EXISTS")` rather than
   * duplicating it.
   */
  insert(record: BackupRecord): Promise<void>;
  /** Every record of `noteId`, ordered by id. */
  listByNote(noteId: NoteId): Promise<readonly BackupRecord[]>;
  /**
   * Deletes at most `limit` records of `noteId` (`limit <= 0` deletes
   * nothing) and answers how many went.
   *
   * The bound is what keeps one purge turn inside its budget: a caller
   * that deletes a full page reschedules itself, and because the rows it
   * deleted cannot come back, reading from the start always moves
   * forward — no cursor is needed. A note with no records is not an
   * error; it answers `0`, which is what makes a redelivered
   * `note.purged` a no-op.
   */
  deleteByNote(noteId: NoteId, limit: number): Promise<number>;
}
