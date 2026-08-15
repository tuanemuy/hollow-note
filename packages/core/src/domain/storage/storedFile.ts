import type { WithEventDrafts } from "@repo/core/domain/common/event";
import { Version } from "@repo/core/domain/common/version";
import { type StorageEvent, StorageEvents } from "./events";
import {
  ByteSize,
  type Checksum,
  FileName,
  type FileProvenance,
  MimeType,
  type ObjectKey,
  type StorageOwner,
  StoredFileId,
} from "./valueObject";

type StoredFileBase = Readonly<{
  id: StoredFileId;
  owner: StorageOwner;
  objectKey: ObjectKey;
  fileName: FileName;
  mimeType: MimeType;
  size: ByteSize;
  checksum: Checksum;
  version: Version;
  createdAt: Date;
  updatedAt: Date;
}>;

type PersistentProvenance = Exclude<FileProvenance, { purpose: "artifact" }>;

/**
 * Excluding artifact provenance from the persistent variant is what
 * makes "a generated file with no expiry" unrepresentable — every
 * artifact carries an `expiresAt` and is reclaimed by its sweep.
 */
export type PersistentFile = StoredFileBase &
  Readonly<{ retention: "persistent" }> &
  PersistentProvenance;

export type EphemeralFile = StoredFileBase &
  Readonly<{ retention: "ephemeral"; expiresAt: Date }> &
  FileProvenance;

export type StoredFile = PersistentFile | EphemeralFile;

type RegisterParams = Readonly<{
  id: string;
  owner: StorageOwner;
  objectKey: ObjectKey;
  fileName: string;
  mimeType: string;
  size: number;
  checksum: Checksum;
}>;

const base = (params: RegisterParams, now: Date): StoredFileBase => ({
  id: StoredFileId.create(params.id),
  owner: params.owner,
  objectKey: params.objectKey,
  fileName: FileName.create(params.fileName),
  mimeType: MimeType.create(params.mimeType),
  size: ByteSize.create(params.size),
  checksum: params.checksum,
  version: Version.initial(),
  createdAt: now,
  updatedAt: now,
});

export const StoredFile = {
  register: (
    params: RegisterParams & PersistentProvenance,
    now: Date,
  ): WithEventDrafts<PersistentFile, StorageEvent> => {
    const file: PersistentFile = {
      ...base(params, now),
      retention: "persistent",
      ...(params.purpose === "avatar"
        ? {
            purpose: params.purpose,
            noteId: null,
            uploadedBy: params.uploadedBy,
          }
        : {
            purpose: params.purpose,
            noteId: params.noteId,
            uploadedBy: params.uploadedBy,
          }),
    };
    return {
      entity: file,
      eventDrafts: [
        StorageEvents.fileStored(
          {
            fileId: file.id,
            owner: file.owner,
            purpose: file.purpose,
            size: file.size,
          },
          now,
        ),
      ],
    };
  },

  isExpired: (file: StoredFile, now: Date): boolean =>
    file.retention === "ephemeral" && file.expiresAt.getTime() <= now.getTime(),
};
