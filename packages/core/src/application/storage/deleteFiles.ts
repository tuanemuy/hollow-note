import { StorageEvents } from "@repo/core/domain/storage/events";
import type { StoredFileId } from "@repo/core/domain/storage/valueObject";
import type { ScopeUnitOfWorkContext } from "../execution/unitOfWork";

/**
 * Shared procedure: deletes stored-file rows and hands the objects
 * themselves to the `storage.fileDeleted` subscriber.
 *
 * It takes the unit-of-work context instead of opening one, so a caller
 * that must delete files in the same transaction as its own write
 * (`storeAvatar` replacing an icon, a job discarding its artifacts) can
 * run it inline. Callers with no transaction of their own go through the
 * `deleteFiles` usecase.
 *
 * Rows are read one at a time through `findById`: the OCC token is only
 * minted there, and deleting without one would bypass the "read with
 * intent to write" contract. Ids that are already gone are skipped
 * rather than reported — a retry of the same deletion must succeed.
 */
export async function deleteStoredFiles(
  ctx: ScopeUnitOfWorkContext,
  fileIds: readonly StoredFileId[],
  deletionOperationId: string | null,
  now: Date,
): Promise<number> {
  let deleted = 0;
  for (const fileId of fileIds) {
    const versioned = await ctx.storedFileRepository.findById(fileId);
    if (versioned === null) {
      continue;
    }
    const file = versioned.entity;
    await ctx.storedFileRepository.delete(fileId, versioned.expectedVersion);
    ctx.collectEvents([
      StorageEvents.fileDeleted(
        {
          fileId: file.id,
          owner: file.owner,
          purpose: file.purpose,
          size: file.size,
          objectKey: file.objectKey,
          deletionOperationId,
        },
        now,
      ),
    ]);
    deleted += 1;
  }
  return deleted;
}
