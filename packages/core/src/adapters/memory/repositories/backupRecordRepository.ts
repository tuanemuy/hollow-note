import { ConflictError } from "../../../application/errors";
import type { BackupRecord } from "../../../domain/integration/backupRecord";
import type { BackupRecordRepository } from "../../../domain/integration/ports/backupRecordRepository";
import type { NoteId } from "../../../domain/note/valueObject";
import type { ScopeStore } from "../store";
import { clone, compareStrings, duplicateKey } from "../support";

const TABLE = "backup_records";

export function createMemoryBackupRecordRepository(
  scope: ScopeStore,
): BackupRecordRepository {
  const table = scope.backupRecords;

  const ofNote = (noteId: NoteId): readonly BackupRecord[] =>
    table
      .values()
      .filter((record) => record.noteId === noteId)
      .sort((a, b) => compareStrings(a.id, b.id));

  return {
    async insert(record: BackupRecord): Promise<void> {
      if (table.has(record.id)) {
        throw duplicateKey(TABLE, record.id);
      }
      if (
        table
          .values()
          .some(
            (stored) =>
              stored.noteId === record.noteId &&
              stored.sourceFileId === record.sourceFileId,
          )
      ) {
        throw new ConflictError(
          "BACKUP_RECORD_ALREADY_EXISTS",
          `Note ${record.noteId} already records a backup of ${record.sourceFileId}`,
        );
      }
      table.set(record.id, clone(record));
    },

    async listByNote(noteId: NoteId): Promise<readonly BackupRecord[]> {
      return ofNote(noteId).map(clone);
    },

    async deleteByNote(noteId: NoteId, limit: number): Promise<number> {
      const doomed = ofNote(noteId).slice(0, Math.max(0, limit));
      for (const record of doomed) {
        table.delete(record.id);
      }
      return doomed.length;
    },
  };
}
