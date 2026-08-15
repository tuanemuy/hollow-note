import type {
  Pagination,
  PaginationResult,
} from "@repo/core/domain/common/pagination";
import type { TransactionalRepository } from "@repo/core/domain/common/transactionalRepository";
import type { StoredFile } from "../storedFile";
import type { FilePurpose, StorageOwner, StoredFileId } from "../valueObject";

/**
 * Bound to the current scope: a file id alone cannot locate its scope,
 * so an outside entry point resolves a note route, a job id, or an
 * explicit storage scope first. `StorageOwner` records who the bytes
 * count against and never overrides the physical scope.
 *
 * Only the methods the avatar and owner-cleanup paths need are declared
 * here; the import slice adds the note / artifact / expiry listings.
 *
 * `listByOwner` returns a `PaginationResult` because a batch of exactly
 * `limit` rows has to be told apart from "there is more" — an owner
 * cleanup that guessed would either stop early or schedule a pointless
 * extra turn. `sumSizeByOwner` leaves `artifact` out, matching the
 * exclusion Usage applies (spec/domains/usage.md).
 *
 * Error contract: `ConflictError("OPTIMISTIC_LOCK_FAILURE")`,
 * `ConflictError("OBJECT_KEY_ALREADY_USED")`,
 * `SystemError(DatabaseError)`.
 */
export interface StoredFileRepository
  extends TransactionalRepository<StoredFile, StoredFileId> {
  listByIds(ids: readonly StoredFileId[]): Promise<readonly StoredFile[]>;
  listByOwner(
    owner: StorageOwner,
    purpose: FilePurpose | null,
    pagination: Pagination,
  ): Promise<PaginationResult<StoredFile>>;
  sumSizeByOwner(owner: StorageOwner): Promise<number>;
}
