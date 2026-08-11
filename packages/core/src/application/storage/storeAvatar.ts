import { BusinessRuleError } from "@repo/core/domain/error";
import { UserId } from "@repo/core/domain/identity/valueObject";
import { UploadValidationPolicy } from "@repo/core/domain/storage/services/uploadValidationPolicy";
import { StoredFile } from "@repo/core/domain/storage/storedFile";
import {
  ObjectKey,
  StorageOwner,
  StoredFileId,
} from "@repo/core/domain/storage/valueObject";
import { WorkspaceErrorCode } from "@repo/core/domain/workspace/errorCode";
import { ScopeKey } from "../scope";
import type { ServiceArgs } from "../types";
import { deleteStoredFiles } from "./deleteFiles";
import type { StoreAvatarView } from "./view";

export type StoreAvatarInput = Readonly<{
  userId: string;
  subjectType: "user" | "workspace";
  subjectId: string;
  fileName: string;
  body: Uint8Array;
}>;

/**
 * How many existing icons one replacement may reclaim. A subject holds
 * one icon at a time, so anything above 1 only exists to absorb rows a
 * previous replacement failed to delete.
 */
const REPLACED_AVATAR_LIMIT = 10;

const EXTENSION_BY_MIME_TYPE: Readonly<Record<string, string>> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

const insufficientRole = () =>
  new BusinessRuleError(
    WorkspaceErrorCode.InsufficientRole,
    "Not allowed to set this icon",
  );

/**
 * Stores a profile / workspace icon (UC-storage-004,
 * spec/usecases/storage.md#storeavatar).
 *
 * Deliberately **does not** check the storage quota: an icon is capped at
 * 5 MB and every replacement deletes the one it replaces, so a subject
 * can never accumulate them — checking would only lock a full account out
 * of a replacement that does not grow its usage (spec, same section). The
 * bytes still count toward `sumSizeByOwner`, so `recalculateStorageUsage`
 * reconciles them.
 *
 * Size and content type are both measured from the body rather than
 * declared by the caller: the policy has to bind the bytes actually
 * stored, and a declaration can disagree with them (ADR-048 / ADR-078).
 *
 * Workspace subjects are refused outright until `WorkspaceAuthorization`
 * exists — "cannot evaluate the permission" is answered as "does not have
 * it", with the same error the real check will raise (ADR-014).
 */
export async function storeAvatar({
  container,
  input,
}: ServiceArgs<StoreAvatarInput>): Promise<StoreAvatarView> {
  const { clock, idGenerator, logger, objectStorage, scopeUnitOfWorkProvider } =
    container;

  const userId = UserId.create(input.userId);
  if (input.subjectType === "workspace" || input.subjectId !== userId) {
    throw insufficientRole();
  }

  const owner = StorageOwner.user(userId);
  const scope = ScopeKey.user(userId);
  const { mimeType, size } = UploadValidationPolicy.ensureAcceptable({
    purpose: "avatar",
    body: input.body,
  });

  const fileId = StoredFileId.create(idGenerator.next());
  const objectKey = ObjectKey.build(
    owner,
    "avatar",
    fileId,
    EXTENSION_BY_MIME_TYPE[mimeType] ?? null,
  );
  const stored = await objectStorage.put(objectKey, input.body, {
    mimeType,
    size,
    checksum: null,
  });

  const now = clock.now();
  try {
    await scopeUnitOfWorkProvider.run(scope, async (ctx) => {
      await ctx.cleanupAdmission.assertWritable();
      await ctx.cleanupAdmission.assertActorWritable(userId);

      // Read the icons to replace *before* inserting the new row, or the
      // replacement would be in its own list of things to delete.
      const replaced = await ctx.storedFileRepository.listByOwner(
        owner,
        "avatar",
        { page: 1, limit: REPLACED_AVATAR_LIMIT },
      );

      const registered = StoredFile.register(
        {
          id: fileId,
          owner,
          objectKey,
          fileName: input.fileName,
          mimeType,
          size: stored.size,
          checksum: stored.checksum,
          purpose: "avatar",
          noteId: null,
          uploadedBy: userId,
        },
        now,
      );
      await ctx.storedFileRepository.insert(registered.entity);
      ctx.collectEvents(registered.eventDrafts);

      await deleteStoredFiles(
        ctx,
        replaced.items.map((file) => file.id),
        null,
        now,
      );
    });
  } catch (error) {
    // The object store cannot join the transaction, so bytes written
    // without their row would be unreachable: no owner scan and no
    // `storage.fileDeleted` would ever name them, not even account
    // deletion. Overwriting the same key is idempotent, so is removing
    // it, and only this call knows the key exists.
    try {
      await objectStorage.deleteMany([objectKey]);
    } catch (cause) {
      logger.error("[storeAvatar] rollback of the stored object failed", {
        cause,
        objectKey,
      });
    }
    throw error;
  }

  return { fileId, url: objectStorage.publicUrl(objectKey) };
}
