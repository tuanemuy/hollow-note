import { ConflictError } from "../../../application/errors";
import type {
  Pagination,
  PaginationResult,
} from "../../../domain/common/pagination";
import type { StoredFileRepository } from "../../../domain/storage/ports/storedFileRepository";
import type { StoredFile } from "../../../domain/storage/storedFile";
import {
  type FilePurpose,
  StorageOwner,
  type StoredFileId,
} from "../../../domain/storage/valueObject";
import type { ScopeStore } from "../store";
import { clone, compareStrings, createOccRepository } from "../support";

const TABLE = "stored_files";

export function createMemoryStoredFileRepository(
  scope: ScopeStore,
): StoredFileRepository {
  const table = scope.storedFiles;
  const occ = createOccRepository<StoredFile, StoredFileId>(TABLE, table);

  const ownedBy = (owner: StorageOwner): readonly StoredFile[] =>
    table
      .values()
      .filter((file) => StorageOwner.equals(file.owner, owner))
      .sort((a, b) => compareStrings(a.id, b.id));

  return {
    ...occ,

    async insert(file: StoredFile): Promise<void> {
      if (
        table.values().some((stored) => stored.objectKey === file.objectKey)
      ) {
        throw new ConflictError(
          "OBJECT_KEY_ALREADY_USED",
          `Object key already used: ${file.objectKey}`,
        );
      }
      await occ.insert(file);
    },

    async listByIds(
      ids: readonly StoredFileId[],
    ): Promise<readonly StoredFile[]> {
      return ids
        .map((id) => table.get(id))
        .filter((file): file is StoredFile => file !== undefined)
        .map(clone);
    },

    async listByOwner(
      owner: StorageOwner,
      purpose: FilePurpose | null,
      pagination: Pagination,
    ): Promise<PaginationResult<StoredFile>> {
      const matched = ownedBy(owner).filter(
        (file) => purpose === null || file.purpose === purpose,
      );
      const offset = Math.max(0, (pagination.page - 1) * pagination.limit);
      return {
        items: matched
          .slice(offset, offset + Math.max(0, pagination.limit))
          .map(clone),
        count: matched.length,
      };
    },

    async sumSizeByOwner(owner: StorageOwner): Promise<number> {
      // Artifacts are excluded: they are expiring by-products, and Usage
      // leaves them out of the total too (spec/domains/usage.md).
      return ownedBy(owner)
        .filter((file) => file.purpose !== "artifact")
        .reduce((total, file) => total + file.size, 0);
    },
  };
}
