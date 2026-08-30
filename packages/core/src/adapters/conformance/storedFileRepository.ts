import { beforeEach, describe, expect, it } from "vitest";
import { Version } from "../../domain/common/version";
import type { NoteId } from "../../domain/note/valueObject";
import type {
  EphemeralFile,
  StoredFile,
} from "../../domain/storage/storedFile";
import { StoredFile as StoredFileOps } from "../../domain/storage/storedFile";
import {
  ByteSize,
  Checksum,
  FileName,
  MimeType,
  ObjectKey,
  StorageOwner,
  StoredFileId,
} from "../../domain/storage/valueObject";
import { expectConflict } from "./asserts";
import type {
  ConformanceBackend,
  MakeConformanceBackend,
  ScopedConformancePorts,
} from "./backend";
import { noteId, scopeOf, userId } from "./fixtures";

const CHECKSUM = Checksum.sha256("a".repeat(64));

/**
 * Shared conformance suite for `StoredFileRepository`
 * (ADP-storage-001..005, 007, 010, 011, 012): OCC over the file rows,
 * the owner-scoped listing and total the avatar and cleanup paths need,
 * and the two bounded sweeps a note purge and the orphan-media
 * collection walk.
 */
export function describeStoredFileRepositoryContract(
  backendName: string,
  makeBackend: MakeConformanceBackend,
): void {
  describe(`StoredFileRepository conformance [${backendName}]`, () => {
    let backend: ConformanceBackend;
    let repository: ScopedConformancePorts["storedFileRepository"];

    const owner = StorageOwner.user(userId(1));
    const otherOwner = StorageOwner.user(userId(2));

    beforeEach(async () => {
      backend = await makeBackend();
      repository = backend.forScope(scopeOf(1)).storedFileRepository;
    });

    const avatar = (n: number, size = 100, fileOwner = owner): StoredFile =>
      StoredFileOps.register(
        {
          id: `file-${n}`,
          owner: fileOwner,
          objectKey: ObjectKey.build(
            fileOwner,
            "avatar",
            StoredFileId.create(`file-${n}`),
            "png",
          ),
          fileName: `avatar-${n}.png`,
          mimeType: "image/png",
          size,
          checksum: CHECKSUM,
          purpose: "avatar",
          noteId: null,
          uploadedBy: userId(1),
        },
        backend.clock.now(),
      ).entity;

    const source = (n: number, size: number): StoredFile =>
      StoredFileOps.register(
        {
          id: `file-${n}`,
          owner,
          objectKey: ObjectKey.build(
            owner,
            "source",
            StoredFileId.create(`file-${n}`),
            "md",
          ),
          fileName: `note-${n}.md`,
          mimeType: "text/markdown",
          size,
          checksum: CHECKSUM,
          purpose: "source",
          noteId: noteId(n),
          uploadedBy: userId(1),
        },
        backend.clock.now(),
      ).entity;

    const noteFile = (
      n: number,
      purpose: "source" | "media" | "reference",
      note: NoteId,
      createdAt: Date = backend.clock.now(),
    ): StoredFile =>
      StoredFileOps.register(
        {
          id: `file-${n}`,
          owner,
          objectKey: ObjectKey.build(
            owner,
            purpose,
            StoredFileId.create(`file-${n}`),
            "bin",
          ),
          fileName: `file-${n}.bin`,
          mimeType: "application/octet-stream",
          size: 10,
          checksum: CHECKSUM,
          purpose,
          noteId: note,
          uploadedBy: userId(1),
        },
        createdAt,
      ).entity;

    // Artifacts are only created by the import slice's
    // `registerEphemeral`; the literal is what lets this suite pin the
    // exclusion `sumSizeByOwner` promises today.
    const artifact = (
      n: number,
      size: number,
      note: NoteId | null = null,
    ): EphemeralFile => ({
      id: StoredFileId.create(`file-${n}`),
      owner,
      objectKey: ObjectKey.build(
        owner,
        "artifact",
        StoredFileId.create(`file-${n}`),
        "pdf",
      ),
      fileName: FileName.create(`export-${n}.pdf`),
      mimeType: MimeType.create("application/pdf"),
      size: ByteSize.create(size),
      checksum: CHECKSUM,
      version: Version.initial(),
      createdAt: backend.clock.now(),
      updatedAt: backend.clock.now(),
      retention: "ephemeral",
      expiresAt: new Date(backend.clock.now().getTime() + 60_000),
      ...(note === null
        ? { purpose: "artifact", noteId: null, noteVersion: null }
        : { purpose: "artifact", noteId: note, noteVersion: 1 }),
      uploadedBy: userId(1),
    });

    it("ADP-storage-001/002: inserts a file and reads it back with a version token", async () => {
      await repository.insert(avatar(1));

      const found = await repository.findById(StoredFileId.create("file-1"));
      expect(found?.entity.fileName).toBe("avatar-1.png");
      expect(found?.expectedVersion).toBe(0);
      expect(
        await repository.findById(StoredFileId.create("absent")),
      ).toBeNull();
    });

    it("ADP-storage-001: refuses a second file on the same object key", async () => {
      await repository.insert(avatar(1));

      await expectConflict(
        repository.insert({
          ...avatar(2),
          objectKey: avatar(1).objectKey,
        }),
        "OBJECT_KEY_ALREADY_USED",
      );
    });

    it("ADP-storage-003: saves only against the observed version", async () => {
      await repository.insert(avatar(1));
      const found = await repository.findById(StoredFileId.create("file-1"));
      if (found === null) {
        throw new Error("file missing");
      }

      const renamed = (name: string): StoredFile => ({
        ...found.entity,
        fileName: FileName.create(name),
        version: Version.next(found.entity.version),
        updatedAt: backend.clock.now(),
      });
      await repository.save(renamed("renamed.png"), found.expectedVersion);

      // The stale token is refused, so a lost update cannot happen.
      await expectConflict(
        repository.save(renamed("clobbered.png"), found.expectedVersion),
        "OPTIMISTIC_LOCK_FAILURE",
      );
      const reread = await repository.findById(found.entity.id);
      expect(reread?.entity.fileName).toBe("renamed.png");
      expect(reread?.expectedVersion).toBe(1);
    });

    it("ADP-storage-004: deletes only against the observed version", async () => {
      await repository.insert(avatar(1));
      const found = await repository.findById(StoredFileId.create("file-1"));
      if (found === null) {
        throw new Error("file missing");
      }

      await repository.delete(found.entity.id, found.expectedVersion);
      expect(await repository.findById(found.entity.id)).toBeNull();
      await expectConflict(
        repository.delete(found.entity.id, found.expectedVersion),
        "OPTIMISTIC_LOCK_FAILURE",
      );
    });

    it("ADP-storage-005: lists by ids and silently skips the ones already gone", async () => {
      await repository.insert(avatar(1));
      await repository.insert(avatar(2));

      const listed = await repository.listByIds([
        StoredFileId.create("file-1"),
        StoredFileId.create("absent"),
      ]);
      expect(listed.map((file) => file.id)).toEqual(["file-1"]);
      expect(await repository.listByIds([])).toEqual([]);
    });

    it("ADP-storage-007: lists a note's source / media / reference files by id, leaving its artifacts and other notes out", async () => {
      await repository.insert(noteFile(3, "reference", noteId(1)));
      await repository.insert(noteFile(1, "source", noteId(1)));
      await repository.insert(noteFile(2, "media", noteId(1)));
      await repository.insert(noteFile(4, "media", noteId(2)));
      // Reclaimed by its own `expiresAt`, not by the note's purge.
      await repository.insert(artifact(5, 10, noteId(1)));
      await repository.insert(avatar(6));

      expect(
        (await repository.listDeletableByNote(noteId(1), 100)).map(
          (file) => file.id,
        ),
      ).toEqual(["file-1", "file-2", "file-3"]);
      // A full page is what tells the caller to schedule another turn,
      // so the bound has to cut exactly at `limit`.
      expect(
        (await repository.listDeletableByNote(noteId(1), 2)).map(
          (file) => file.id,
        ),
      ).toEqual(["file-1", "file-2"]);
      expect(await repository.listDeletableByNote(noteId(1), 0)).toEqual([]);
      expect(await repository.listDeletableByNote(noteId(9), 100)).toEqual([]);
    });

    it("ADP-storage-010: lists one purpose oldest first, including the boundary instant and excluding anything newer", async () => {
      const cutoff = new Date(backend.clock.now().getTime() + 60_000);
      await repository.insert(
        noteFile(1, "media", noteId(1), new Date(cutoff.getTime() + 1)),
      );
      await repository.insert(noteFile(2, "media", noteId(1), cutoff));
      await repository.insert(
        noteFile(3, "media", noteId(1), new Date(cutoff.getTime() - 2)),
      );
      await repository.insert(
        noteFile(4, "reference", noteId(1), new Date(cutoff.getTime() - 2)),
      );

      // Oldest first — the ids run the other way, so an id order would
      // answer `file-2, file-3` here.
      expect(
        (await repository.listByPurposeOlderThan("media", cutoff, 100)).map(
          (file) => file.id,
        ),
      ).toEqual(["file-3", "file-2"]);
      expect(
        (await repository.listByPurposeOlderThan("media", cutoff, 1)).map(
          (file) => file.id,
        ),
      ).toEqual(["file-3"]);
      expect(
        (await repository.listByPurposeOlderThan("reference", cutoff, 100)).map(
          (file) => file.id,
        ),
      ).toEqual(["file-4"]);
      expect(
        await repository.listByPurposeOlderThan("media", cutoff, 0),
      ).toEqual([]);
      expect(
        await repository.listByPurposeOlderThan(
          "media",
          new Date(cutoff.getTime() - 3),
          100,
        ),
      ).toEqual([]);
    });

    it("ADP-storage-012: pages an owner's files and reports the total so a full page is not mistaken for the end", async () => {
      await repository.insert(avatar(1));
      await repository.insert(source(2, 10));
      await repository.insert(avatar(3, 100, otherOwner));

      const firstPage = await repository.listByOwner(owner, null, {
        page: 1,
        limit: 1,
      });
      expect(firstPage.items).toHaveLength(1);
      expect(firstPage.count).toBe(2);

      const secondPage = await repository.listByOwner(owner, null, {
        page: 2,
        limit: 1,
      });
      expect(secondPage.items).toHaveLength(1);
      expect(secondPage.items[0]?.id).not.toBe(firstPage.items[0]?.id);

      const onlyAvatars = await repository.listByOwner(owner, "avatar", {
        page: 1,
        limit: 100,
      });
      expect(onlyAvatars.items.map((file) => file.id)).toEqual(["file-1"]);
      expect(onlyAvatars.count).toBe(1);
    });

    it("ADP-storage-011: sums an owner's bytes, leaving artifacts out", async () => {
      await repository.insert(avatar(1, 100));
      await repository.insert(source(2, 25));
      await repository.insert(artifact(3, 1000));
      await repository.insert(avatar(4, 999, otherOwner));

      expect(await repository.sumSizeByOwner(owner)).toBe(125);
      expect(await repository.sumSizeByOwner(otherOwner)).toBe(999);
    });

    it("keeps files of different scopes apart", async () => {
      await repository.insert(avatar(1));

      expect(
        await backend
          .forScope(scopeOf(2))
          .storedFileRepository.findById(StoredFileId.create("file-1")),
      ).toBeNull();
    });
  });
}
