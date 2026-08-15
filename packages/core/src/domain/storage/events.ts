import type {
  DomainEventBase,
  EventDraft,
} from "@repo/core/domain/common/event";
import type {
  ByteSize,
  FilePurpose,
  ObjectKey,
  StorageOwner,
  StoredFileId,
} from "./valueObject";

const ownerAggregateId = (owner: StorageOwner): string =>
  owner.type === "user"
    ? `user:${owner.userId}`
    : `workspace:${owner.workspaceId}`;

/** `purpose` travels so Usage can leave artifacts out of the total. */
export type FileStoredEvent = DomainEventBase<
  "storage.fileStored",
  Readonly<{
    fileId: StoredFileId;
    owner: StorageOwner;
    purpose: FilePurpose;
    size: ByteSize;
  }>
>;

/**
 * Metadata and object cannot be deleted in one transaction, so the row
 * goes first and the object is reclaimed by the `deleteStoredObjects`
 * subscriber — which is why `objectKey` rides along: the subscriber must
 * not have to read a row that is already gone.
 */
export type FileDeletedEvent = DomainEventBase<
  "storage.fileDeleted",
  Readonly<{
    fileId: StoredFileId;
    owner: StorageOwner;
    purpose: FilePurpose;
    size: ByteSize;
    objectKey: ObjectKey;
    deletionOperationId: string | null;
  }>
>;

export type StorageEvent = FileStoredEvent | FileDeletedEvent;

export const StorageEvents = {
  fileStored: (
    params: Readonly<{
      fileId: StoredFileId;
      owner: StorageOwner;
      purpose: FilePurpose;
      size: ByteSize;
    }>,
    occurredAt: Date,
  ): EventDraft<FileStoredEvent> => ({
    type: "storage.fileStored",
    payload: params,
    occurredAt,
    aggregateId: ownerAggregateId(params.owner),
  }),

  fileDeleted: (
    params: Readonly<{
      fileId: StoredFileId;
      owner: StorageOwner;
      purpose: FilePurpose;
      size: ByteSize;
      objectKey: ObjectKey;
      deletionOperationId: string | null;
    }>,
    occurredAt: Date,
  ): EventDraft<FileDeletedEvent> => ({
    type: "storage.fileDeleted",
    payload: params,
    occurredAt,
    aggregateId: ownerAggregateId(params.owner),
  }),
};
