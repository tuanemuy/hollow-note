import { Version } from "@repo/core/domain/common/version";
import { RehydrationError } from "@repo/core/domain/error";
import { UserId } from "@repo/core/domain/identity/valueObject";
import { NoteId } from "@repo/core/domain/note/valueObject";
import { Checksum, StoredFileId } from "@repo/core/domain/storage/valueObject";
import { BackupRecordId, ExternalFileRef } from "./valueObject";

/**
 * Where one source file of a note was copied in the recording user's own
 * Drive. `userId` is the connection owner, not the note's scope — a
 * workspace note's records are keyed by whoever ran the backup — so the
 * row is addressable only through `noteId`, which is what makes the
 * note-purge fan-out the single path that reclaims it.
 *
 * Only the rehydration side is here. The write side (`record` /
 * `replace` / `updateExternalRef` / `matches` and the
 * `integration.backupCompleted` draft) belongs to the backup slice; this
 * slice needs the row a purged note's records are read and deleted
 * through.
 */
export type BackupRecord = Readonly<{
  id: BackupRecordId;
  userId: UserId;
  noteId: NoteId;
  sourceFileId: StoredFileId;
  external: ExternalFileRef;
  checksum: Checksum;
  version: Version;
  backedUpAt: Date;
  updatedAt: Date;
}>;

type ReconstructInput = Readonly<{
  id: string;
  userId: string;
  noteId: string;
  sourceFileId: string;
  externalFileId: string;
  webViewUrl: string;
  checksumValue: string;
  version: number;
  backedUpAt: Date;
  updatedAt: Date;
}>;

export const BackupRecord = {
  reconstruct: (input: ReconstructInput): BackupRecord => {
    try {
      return {
        id: BackupRecordId.create(input.id),
        userId: UserId.create(input.userId),
        noteId: NoteId.create(input.noteId),
        sourceFileId: StoredFileId.create(input.sourceFileId),
        external: ExternalFileRef.create(
          input.externalFileId,
          input.webViewUrl,
        ),
        checksum: Checksum.sha256(input.checksumValue),
        version: Version.create(input.version),
        backedUpAt: input.backedUpAt,
        updatedAt: input.updatedAt,
      };
    } catch (error) {
      throw new RehydrationError(
        `Failed to reconstruct BackupRecord ${input.id}`,
        error,
      );
    }
  },
};
