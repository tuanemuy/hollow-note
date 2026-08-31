import { beforeEach, describe, expect, it } from "vitest";
import { isSystemError } from "../../application/errors";
import { BackupRecord } from "../../domain/integration/backupRecord";
import type { NoteId } from "../../domain/note/valueObject";
import { expectConflict } from "./asserts";
import type {
  ConformanceBackend,
  MakeConformanceBackend,
  ScopedConformancePorts,
} from "./backend";
import { noteId, scopeOf, userId } from "./fixtures";

/**
 * Shared conformance suite for the delete side of
 * `BackupRecordRepository` (ADP-integration-008, 014): the insert with
 * its `(noteId, sourceFileId)` uniqueness, the per-note listing, and the
 * bounded per-note delete a note purge walks.
 */
export function describeBackupRecordRepositoryContract(
  backendName: string,
  makeBackend: MakeConformanceBackend,
): void {
  describe(`BackupRecordRepository conformance [${backendName}]`, () => {
    let backend: ConformanceBackend;
    let repository: ScopedConformancePorts["backupRecordRepository"];

    beforeEach(async () => {
      backend = await makeBackend();
      repository = backend.forScope(scopeOf(1)).backupRecordRepository;
    });

    const record = (
      n: number,
      note: NoteId,
      sourceFile: string,
      owner = 1,
    ): BackupRecord =>
      BackupRecord.reconstruct({
        id: `backup-${String(n).padStart(3, "0")}`,
        userId: userId(owner),
        noteId: note,
        sourceFileId: sourceFile,
        externalFileId: `drive-${n}`,
        webViewUrl: `https://drive.example.test/${n}`,
        checksumValue: "b".repeat(64),
        version: 0,
        backedUpAt: backend.clock.now(),
        updatedAt: backend.clock.now(),
      });

    it("ADP-integration-008: rejects a second record of the same source file of the same note", async () => {
      await repository.insert(record(1, noteId(1), "file-1"));

      await expectConflict(
        repository.insert(record(2, noteId(1), "file-1")),
        "BACKUP_RECORD_ALREADY_EXISTS",
      );
      // The same source file id under another note, and another source
      // file of the same note, are both legitimate.
      await repository.insert(record(3, noteId(2), "file-1"));
      await repository.insert(record(4, noteId(1), "file-2"));

      const rows = await repository.listByNote(noteId(1));
      expect(rows.map((r) => r.id)).toEqual(["backup-001", "backup-004"]);
      expect(rows[0]).toEqual(record(1, noteId(1), "file-1"));
    });

    it("ADP-integration-008: answers a re-used record id with a fault, not the source-file conflict", async () => {
      await repository.insert(record(1, noteId(1), "file-1"));

      // The two unique constraints of the table mean different things:
      // losing the `(noteId, sourceFileId)` race is a conflict the
      // caller can accept, while minting the same id twice is a fault it
      // must fix. A backend that collapses them tells the caller to
      // retry the one that will never succeed.
      await expect(
        repository.insert(record(1, noteId(2), "file-2")),
      ).rejects.toSatisfy(isSystemError);
      expect(await repository.listByNote(noteId(2))).toEqual([]);
      expect((await repository.listByNote(noteId(1))).map((r) => r.id)).toEqual(
        ["backup-001"],
      );
    });

    it("ADP-integration-014: deletes at most `limit` records of one note, whoever owns them", async () => {
      for (let n = 1; n <= 5; n += 1) {
        // Owner alternates: a workspace note's records belong to
        // whoever ran the backup, and the note purge takes them all.
        await repository.insert(record(n, noteId(1), `file-${n}`, n % 2));
      }
      await repository.insert(record(6, noteId(2), "file-1"));

      expect(await repository.deleteByNote(noteId(1), 0)).toBe(0);
      // A full page is what tells the caller to schedule another turn,
      // so the bound has to cut exactly at `limit`.
      expect(await repository.deleteByNote(noteId(1), 2)).toBe(2);
      expect((await repository.listByNote(noteId(1))).map((r) => r.id)).toEqual(
        ["backup-003", "backup-004", "backup-005"],
      );

      expect(await repository.deleteByNote(noteId(1), 100)).toBe(3);
      expect(await repository.listByNote(noteId(1))).toEqual([]);
      // Nothing left is a normal answer, not an error — that is what
      // makes a redelivered purge a no-op.
      expect(await repository.deleteByNote(noteId(1), 100)).toBe(0);
      expect((await repository.listByNote(noteId(2))).map((r) => r.id)).toEqual(
        ["backup-006"],
      );
    });
  });
}
