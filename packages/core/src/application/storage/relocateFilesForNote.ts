import { Version } from "@repo/core/domain/common/version";
import type { UserId } from "@repo/core/domain/identity/valueObject";
import type { NoteId } from "@repo/core/domain/note/valueObject";
import type { StoredFile } from "@repo/core/domain/storage/storedFile";
import type {
  ByteSize,
  Checksum,
  FileName,
  MimeType,
  ObjectKey,
  StorageOwner,
  StoredFileId,
} from "@repo/core/domain/storage/valueObject";
import type { ScopeUnitOfWorkContext } from "../execution/unitOfWork";
import { armOrphanMediaSweepOnFirstMedia } from "./collectOrphanMedia";

/**
 * Purposes a note move carries. `artifact` stays behind in the Job scope
 * and is reclaimed by its TTL, and `avatar` belongs to no note at all.
 */
export const RELOCATABLE_PURPOSES = ["source", "media", "reference"] as const;

export type RelocatablePurpose = (typeof RELOCATABLE_PURPOSES)[number];

export type RelocateFilesPhase =
  | "snapshotSource"
  | "stageTarget"
  | "retireSource";

/**
 * Portable projection of one `StoredFile`: everything except the owner,
 * which is exactly what the move replaces. `objectKey` travels unchanged
 * — the R2 bytes never move, so the target row points at the same object
 * the source row pointed at.
 */
export type MovedFileMetadata = Readonly<{
  id: StoredFileId;
  objectKey: ObjectKey;
  fileName: FileName;
  mimeType: MimeType;
  size: ByteSize;
  checksum: Checksum;
  purpose: RelocatablePurpose;
  noteId: NoteId;
  uploadedBy: UserId;
  /** Non-null only for an ephemeral row; a persistent one carries none. */
  expiresAt: Date | null;
  createdAt: Date;
}>;

export type RelocateFilesForNoteInput = Readonly<{
  migrationId: string;
  phase: RelocateFilesPhase;
  noteId: NoteId;
  /** Owner the bound scope holds the rows under. */
  owner: StorageOwner;
  /** Owner the staged rows are registered under (`stageTarget` only). */
  targetOwner: StorageOwner;
  /** Snapshot payload; required by `stageTarget` / `retireSource`. */
  files?: readonly MovedFileMetadata[];
  now: Date;
}>;

export type RelocateFilesForNoteView = Readonly<{
  relocatedCount: number;
  /** The snapshot `snapshotSource` froze; empty in the other phases. */
  files: readonly MovedFileMetadata[];
}>;

/** Page size of the owner scan `snapshotSource` filters by note. */
const SCAN_PAGE_SIZE = 100;

/**
 * Command key namespace, so the storage half of a phase is deduplicated
 * independently of the move phase that encloses it. Exported because the
 * enclosing saga's compensation has to clear the keys of the phases it
 * reverses (`AppliedOperationStore.clearApplied`).
 */
export const relocateFilesCommandKey = (phase: RelocateFilesPhase): string =>
  `storage.relocateFilesForNote:${phase}`;

type RelocatableFile = StoredFile &
  Readonly<{
    purpose: RelocatablePurpose;
    noteId: NoteId;
    uploadedBy: UserId;
  }>;

const isRelocatable = (file: StoredFile): file is RelocatableFile =>
  file.purpose === "source" ||
  file.purpose === "media" ||
  file.purpose === "reference";

const toMetadata = (file: RelocatableFile): MovedFileMetadata => ({
  id: file.id,
  objectKey: file.objectKey,
  fileName: file.fileName,
  mimeType: file.mimeType,
  size: file.size,
  checksum: file.checksum,
  purpose: file.purpose,
  noteId: file.noteId,
  uploadedBy: file.uploadedBy,
  expiresAt: file.retention === "ephemeral" ? file.expiresAt : null,
  createdAt: file.createdAt,
});

const toStoredFile = (
  meta: MovedFileMetadata,
  owner: StorageOwner,
  now: Date,
): StoredFile => {
  const base = {
    id: meta.id,
    owner,
    objectKey: meta.objectKey,
    fileName: meta.fileName,
    mimeType: meta.mimeType,
    size: meta.size,
    checksum: meta.checksum,
    // The staged row is a first-time insert in the target scope, so its
    // OCC counter starts over; the source row keeps its own until retire.
    version: Version.initial(),
    createdAt: meta.createdAt,
    updatedAt: now,
    purpose: meta.purpose,
    noteId: meta.noteId,
    uploadedBy: meta.uploadedBy,
  };
  return meta.expiresAt === null
    ? { ...base, retention: "persistent" }
    : { ...base, retention: "ephemeral", expiresAt: meta.expiresAt };
};

/**
 * Enumerates the note's relocatable rows.
 *
 * The scan goes through `listByOwner` and filters on `noteId` rather
 * than through `listDeletableByNote`, which covers exactly the same
 * purposes: that one is capped at `limit` with no way to tell a full
 * page from the end, because a purge turn reschedules itself and the
 * rows it read are gone. A move reads without deleting, so it needs the
 * `PaginationResult` only `listByOwner` returns. The result is the same
 * set; only the cost differs.
 *
 * `listByNote`, which spec/domains/storage.md assigns to this path, is
 * not on the port yet (`StoredFileRepository`), so the note's rows are
 * composed here from `listByOwner` filtered on `noteId`.
 */
async function listNoteFiles(
  ctx: ScopeUnitOfWorkContext,
  owner: StorageOwner,
  noteId: NoteId,
): Promise<readonly MovedFileMetadata[]> {
  const collected: MovedFileMetadata[] = [];
  for (const purpose of RELOCATABLE_PURPOSES) {
    for (let page = 1; ; page += 1) {
      const result = await ctx.storedFileRepository.listByOwner(
        owner,
        purpose,
        { page, limit: SCAN_PAGE_SIZE },
      );
      for (const file of result.items) {
        if (isRelocatable(file) && file.noteId === noteId) {
          collected.push(toMetadata(file));
        }
      }
      if (
        result.items.length < SCAN_PAGE_SIZE ||
        page * SCAN_PAGE_SIZE >= result.count
      ) {
        break;
      }
    }
  }
  return collected;
}

/**
 * Moves a note's stored-file metadata between scopes.
 *
 * An internal command of the move saga, not a subscriber of `note.moved`:
 * it takes the enclosing phase's unit-of-work context rather than opening
 * one, because the metadata write and the phase that authorized it must
 * commit together.
 *
 * R2 never sees this. `stageTarget` registers rows pointing at the *same*
 * object keys and emits no `storage.fileStored`, and `retireSource` drops
 * the source rows without a `storage.fileDeleted` — emitting one would
 * reclaim an object the target row is still referencing.
 *
 * Each phase is deduplicated on `migrationId + phase` through
 * `AppliedOperationStore`, so a lost response replays into the same
 * outcome instead of a second set of rows or a second deletion. A note
 * with no relocatable file succeeds with `relocatedCount: 0`.
 *
 * The key asserts that the phase's rows are in place, so a caller that
 * *undoes* a phase owes `clearApplied(relocateFilesCommandKey(phase))` in
 * the same transaction — otherwise a resume on the same migration id
 * skips the staging it has just been given back.
 */
export async function relocateFilesForNote(
  ctx: ScopeUnitOfWorkContext,
  input: RelocateFilesForNoteInput,
): Promise<RelocateFilesForNoteView> {
  if (input.phase === "snapshotSource") {
    // A pure read: the source rows stay until the route switch, so a
    // reader that arrives before it still resolves the note's files.
    const files = await listNoteFiles(ctx, input.owner, input.noteId);
    return { relocatedCount: files.length, files };
  }

  const files = input.files ?? [];
  if (files.length === 0) {
    return { relocatedCount: 0, files: [] };
  }
  if (
    !(await ctx.appliedOperationStore.markApplied({
      operationId: input.migrationId,
      commandKey: relocateFilesCommandKey(input.phase),
    }))
  ) {
    return { relocatedCount: 0, files: [] };
  }

  if (input.phase === "stageTarget") {
    // A move is the other way media enters a scope, and the target may
    // never have held any. Arming has to happen before the rows land:
    // "no media yet" is read from the rows themselves, and a staged row
    // carries the *source*'s `createdAt`, so afterwards the answer is
    // already no.
    if (files.some((meta) => meta.purpose === "media")) {
      await armOrphanMediaSweepOnFirstMedia(ctx, input.now);
    }
    for (const meta of files) {
      await ctx.storedFileRepository.insert(
        toStoredFile(meta, input.targetOwner, input.now),
      );
    }
    return { relocatedCount: files.length, files: [] };
  }

  let removed = 0;
  for (const meta of files) {
    const versioned = await ctx.storedFileRepository.findById(meta.id);
    if (versioned === null) {
      continue;
    }
    await ctx.storedFileRepository.delete(meta.id, versioned.expectedVersion);
    removed += 1;
  }
  return { relocatedCount: removed, files: [] };
}
