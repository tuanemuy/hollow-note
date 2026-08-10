import { beforeEach, describe, expect, it } from "vitest";
import { RevisionId } from "../../domain/note/valueObject";
import type {
  ConformanceBackend,
  MakeConformanceBackend,
  ScopedConformancePorts,
} from "./backend";
import {
  makeBlankNote,
  makeRevision,
  noteId,
  scopeOf,
  userId,
} from "./fixtures";

/** Shared conformance suite for `NoteRevisionRepository` (ADP-note-016..020). */
export function describeNoteRevisionRepositoryContract(
  backendName: string,
  makeBackend: MakeConformanceBackend,
): void {
  describe(`NoteRevisionRepository conformance [${backendName}]`, () => {
    let backend: ConformanceBackend;
    let scoped: ScopedConformancePorts;

    beforeEach(async () => {
      backend = await makeBackend();
      scoped = backend.forScope(scopeOf(1));
    });

    const seedRevisions = async (count: number): Promise<void> => {
      const note = makeBlankNote(1, userId(1), backend.clock.now());
      for (let n = 1; n <= count; n += 1) {
        backend.clock.advance(1000);
        await scoped.noteRevisionRepository.insert(
          makeRevision(n, note, backend.clock.now()),
        );
      }
    };

    it("ADP-note-016/018: insert then findById round-trips", async () => {
      const note = makeBlankNote(1, userId(1), backend.clock.now());
      const revision = makeRevision(1, note, backend.clock.now());
      await scoped.noteRevisionRepository.insert(revision);

      expect(
        await scoped.noteRevisionRepository.findById(
          RevisionId.create("revision-001"),
        ),
      ).toEqual(revision);
      expect(
        await scoped.noteRevisionRepository.findById(
          RevisionId.create("revision-999"),
        ),
      ).toBeNull();
    });

    it("ADP-note-017: listByNote returns newest first, bounded by limit", async () => {
      await seedRevisions(3);
      const listed = await scoped.noteRevisionRepository.listByNote(
        noteId(1),
        2,
      );
      expect(listed.map((revision) => revision.id)).toEqual([
        "revision-003",
        "revision-002",
      ]);
    });

    it("ADP-note-019: deleteOlderThanNewest keeps the newest `keep` rows", async () => {
      await seedRevisions(4);
      expect(
        await scoped.noteRevisionRepository.deleteOlderThanNewest(noteId(1), 2),
      ).toBe(2);
      const remaining = await scoped.noteRevisionRepository.listByNote(
        noteId(1),
        10,
      );
      expect(remaining.map((revision) => revision.id)).toEqual([
        "revision-004",
        "revision-003",
      ]);
    });

    it("ADP-note-020: deleteByNote removes every revision of the note", async () => {
      await seedRevisions(2);
      expect(await scoped.noteRevisionRepository.deleteByNote(noteId(1))).toBe(
        2,
      );
      expect(
        await scoped.noteRevisionRepository.listByNote(noteId(1), 10),
      ).toEqual([]);
    });
  });
}
