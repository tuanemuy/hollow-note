import { UserId } from "@repo/core/domain/identity/valueObject";
import type {
  FileDeletedEvent,
  FileStoredEvent,
} from "@repo/core/domain/storage/events";
import {
  ByteSize,
  ObjectKey,
  type StorageOwner,
  StorageOwner as StorageOwnerOps,
  StoredFileId,
} from "@repo/core/domain/storage/valueObject";
import { WorkspaceId } from "@repo/core/domain/workspace/valueObject";
import { z } from "zod";
import { buildEventDecoder } from "../events/buildDecoder";

/**
 * Wire decoders for the storage events. Strict schemas: unexpected keys
 * fail as `SystemError(DataIntegrityError)`.
 */

const ownerSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("user"), userId: z.string().min(1) }).strict(),
  z
    .object({ type: z.literal("workspace"), workspaceId: z.string().min(1) })
    .strict(),
]);
type OwnerWire = z.infer<typeof ownerSchema>;

const rehydrateOwner = (owner: OwnerWire): StorageOwner =>
  owner.type === "user"
    ? StorageOwnerOps.user(UserId.create(owner.userId))
    : StorageOwnerOps.workspace(WorkspaceId.create(owner.workspaceId));

const purposeSchema = z.enum([
  "source",
  "media",
  "reference",
  "artifact",
  "avatar",
]);

export const storageEventDecoders = {
  "storage.fileStored": buildEventDecoder<
    FileStoredEvent,
    {
      fileId: string;
      owner: OwnerWire;
      purpose: z.infer<typeof purposeSchema>;
      size: number;
    }
  >(
    "storage.fileStored",
    z
      .object({
        fileId: z.string().min(1),
        owner: ownerSchema,
        purpose: purposeSchema,
        size: z.number().int().nonnegative(),
      })
      .strict(),
    (parsed) => ({
      fileId: StoredFileId.create(parsed.fileId),
      owner: rehydrateOwner(parsed.owner),
      purpose: parsed.purpose,
      size: ByteSize.create(parsed.size),
    }),
  ),

  "storage.fileDeleted": buildEventDecoder<
    FileDeletedEvent,
    {
      fileId: string;
      owner: OwnerWire;
      purpose: z.infer<typeof purposeSchema>;
      size: number;
      objectKey: string;
      deletionOperationId: string | null;
    }
  >(
    "storage.fileDeleted",
    z
      .object({
        fileId: z.string().min(1),
        owner: ownerSchema,
        purpose: purposeSchema,
        size: z.number().int().nonnegative(),
        objectKey: z.string().min(1),
        deletionOperationId: z.string().min(1).nullable(),
      })
      .strict(),
    (parsed) => ({
      fileId: StoredFileId.create(parsed.fileId),
      owner: rehydrateOwner(parsed.owner),
      purpose: parsed.purpose,
      size: ByteSize.create(parsed.size),
      objectKey: ObjectKey.create(parsed.objectKey),
      deletionOperationId: parsed.deletionOperationId,
    }),
  ),
} as const;
