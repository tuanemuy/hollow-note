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
 * Exclusive keyset position in the `listByPurposeOlderThan` order — the
 * `(createdAt, id)` of the last row a caller has already seen.
 *
 * It names a position, not a row: the row it was taken from may since
 * have been deleted (a sweep normally deletes some of the page it just
 * read), and the position still resolves. A keyset rather than an
 * offset, so rows removed ahead of it cannot shift the ones behind it
 * out of the walk.
 */
export type StoredFilePurposeCursor = Readonly<{
  createdAt: Date;
  id: StoredFileId;
}>;

/**
 * Bound to the current scope: a file id alone cannot locate its scope,
 * so an outside entry point resolves a note route, a job id, or an
 * explicit storage scope first. `StorageOwner` records who the bytes
 * count against and never overrides the physical scope.
 *
 * Declared here are the methods the avatar, owner-cleanup, note-purge
 * and orphan-media paths need. Three of the listings
 * spec/domains/storage.md names are still to come: the artifact ones
 * (`findArtifactByNoteAndVersion`, `listExpired`) arrive with the slice
 * that generates artifacts, and `listByNote` — one note's rows of every
 * purpose, which that design assigns to the move — arrives with the
 * slice that needs the purposes a move leaves behind
 * (`relocateFilesForNote` composes the relocatable subset it does need
 * out of `listByOwner`).
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
   * `listByOwner`.
   *
   * The order is total and contractual: `createdAt` ascending, `id`
   * ascending within one instant. `after` starts the page **strictly
   * past** that position (`null` starts at the head), and being able to
   * ask for it is what makes the walk advance at all: the sweep keeps
   * the rows it decides to spare, so a caller that always read from the
   * head would re-read the same full page of spared rows forever and
   * never reach what is behind them. A caller that receives a full page
   * therefore continues from the `(createdAt, id)` of its last row.
   */
  listByPurposeOlderThan(
    purpose: FilePurpose,
    createdBefore: Date,
    limit: number,
    after: StoredFilePurposeCursor | null,
  ): Promise<readonly StoredFile[]>;
  listByOwner(
    owner: StorageOwner,
    purpose: FilePurpose | null,
    pagination: Pagination,
  ): Promise<PaginationResult<StoredFile>>;
  sumSizeByOwner(owner: StorageOwner): Promise<number>;
}
