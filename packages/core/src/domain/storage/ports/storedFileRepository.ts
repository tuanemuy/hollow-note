import type {
  Pagination,
  PaginationResult,
} from "@repo/core/domain/common/pagination";
import type { TransactionalRepository } from "@repo/core/domain/common/transactionalRepository";
import type { NoteId } from "@repo/core/domain/note/valueObject";
import type { StoredFile } from "../storedFile";
import type { FilePurpose, StorageOwner, StoredFileId } from "../valueObject";

/**
 * Purposes a note owns the bytes of, and therefore the ones its purge
 * reclaims. `artifact` is left out because it is a by-product that lives
 * in the Job scope and is collected by its own `expiresAt`, and `avatar`
 * belongs to no note at all.
 */
export const NOTE_DELETABLE_PURPOSES = [
  "source",
  "media",
  "reference",
] as const;

export type NoteDeletablePurpose = (typeof NOTE_DELETABLE_PURPOSES)[number];

/**
 * Bound to the current scope: a file id alone cannot locate its scope,
 * so an outside entry point resolves a note route, a job id, or an
 * explicit storage scope first. `StorageOwner` records who the bytes
 * count against and never overrides the physical scope.
 *
 * Declared here are the methods the avatar, owner-cleanup, note-purge
 * and orphan-media paths need; the artifact listings
 * (`findArtifactByNoteAndVersion`, `listExpired`) arrive with the slice
 * that generates artifacts.
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
  /**
   * Files of `noteId` whose purpose is one of
   * `NOTE_DELETABLE_PURPOSES`, ordered by id and capped at `limit`
   * (`limit <= 0` yields nothing).
   *
   * The bound is what keeps one purge turn inside its budget: a caller
   * that receives a full page reschedules itself, and because the turn
   * deletes the rows it just read, the next call starts past them. The
   * order only has to be total for that progress to hold.
   */
  listDeletableByNote(
    noteId: NoteId,
    limit: number,
  ): Promise<readonly StoredFile[]>;
  /**
   * Files of `purpose` created at or before `createdBefore`, **oldest
   * first**, capped at `limit` (`limit <= 0` yields nothing). The
   * boundary is inclusive: a file created exactly `createdBefore` is in
   * the page.
   *
   * Owner-independent by design — the orphan-media sweep walks a whole
   * scope and has no owner to filter by, which is why it cannot use
   * `listByOwner`. Oldest-first is contractual rather than incidental:
   * the sweep keeps the rows it decides to spare, so a repeated turn
   * would re-read the same page forever under any order that lets a
   * newer row displace an older one.
   */
  listByPurposeOlderThan(
    purpose: FilePurpose,
    createdBefore: Date,
    limit: number,
  ): Promise<readonly StoredFile[]>;
  listByOwner(
    owner: StorageOwner,
    purpose: FilePurpose | null,
    pagination: Pagination,
  ): Promise<PaginationResult<StoredFile>>;
  sumSizeByOwner(owner: StorageOwner): Promise<number>;
}
