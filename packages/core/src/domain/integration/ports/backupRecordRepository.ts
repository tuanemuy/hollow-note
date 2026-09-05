import type { NoteId } from "@repo/core/domain/note/valueObject";
import type { BackupRecord } from "../backupRecord";

/**
 * Backup records of the **current scope**. The rows live in the scope
 * object of the note they describe, never in the recording user's own
 * scope, so no **cross-scope** `deleteByUser` exists (spec/domains/
 * integration.md): an account deletion sends a command to each scope its
 * directory lists instead of reaching across scopes, and the per-scope
 * `deleteByUser` the spec declares arrives with the slice that reclaims
 * a user's records.
 *
 * Declared here is the surface the note-purge fan-out needs
 * (`deleteBackupRecordsForNote`). The OCC half of the aggregate
 * (`findById` / `save` / `delete`) and `findByNoteAndFile` /
 * `listByNotes` arrive with the slice that records backups.
 *
 * Deleting a record never touches the file in the user's Drive: the copy
 * is theirs and its fate is theirs (IN-09).
 *
 * Error contract: `ConflictError("BACKUP_RECORD_ALREADY_EXISTS")`,
 * `SystemError(DatabaseError)`.
 */
export interface BackupRecordRepository {
  /**
   * Adds one record. `(noteId, sourceFileId)` is unique, so recording
   * the same source file twice raises
   * `ConflictError("BACKUP_RECORD_ALREADY_EXISTS")` rather than
   * duplicating it.
   *
   * The id is unique too, but for a different reason, so it answers a
   * different error: re-using a `BackupRecordId` is a minting fault, not
   * a race two callers can lose, and it raises
   * `SystemError(DatabaseError)`. A backend that collapsed the two
   * constraints into one error would tell a caller to retry what it must
   * fix.
   */
  insert(record: BackupRecord): Promise<void>;
  /**
   * Every record of `noteId`, ordered by id.
   *
   * The order is part of the contract, not a backend's discretion: it is
   * what makes a listing comparable across backends and reproducible
   * between two reads of the same unchanged note.
   */
  listByNote(noteId: NoteId): Promise<readonly BackupRecord[]>;
  /**
   * Deletes at most `limit` records of `noteId` (`limit <= 0` deletes
   * nothing) and answers how many went.
   *
   * The page is taken from the start of the same `BackupRecordId`
   * ascending order `listByNote` answers. Which rows a bounded call
   * removes is part of the contract, not a backend's discretion — it is
   * what makes the remainder after a partial delete the same on every
   * backend.
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
