import { beforeEach, describe, expect, it } from "vitest";
import { Note } from "../../domain/note/note";
import { NoteOwner } from "../../domain/note/valueObject";
import { expectConflict } from "./asserts";
import type {
  ConformanceBackend,
  MakeConformanceBackend,
  ScopedConformancePorts,
} from "./backend";
import { makeBlankNote, noteId, scopeOf, userId } from "./fixtures";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Shared conformance suite for `NoteRepository` (ADP-note-008..015). */
export function describeNoteRepositoryContract(
  backendName: string,
  makeBackend: MakeConformanceBackend,
): void {
  describe(`NoteRepository conformance [${backendName}]`, () => {
    let backend: ConformanceBackend;
    let scoped: ScopedConformancePorts;

    beforeEach(async () => {
      backend = await makeBackend();
      scoped = backend.forScope(scopeOf(1));
    });

    it("ADP-note-008/009: insert then findById round-trips with a version token", async () => {
      const now = backend.clock.now();
      const note = makeBlankNote(1, userId(1), now);
      await scoped.noteRepository.insert(note);

      const found = await scoped.noteRepository.findById(noteId(1));
      expect(found?.entity).toEqual(note);
      expect(found?.expectedVersion).toBe(0);
    });

    it("ADP-note-010/011: save and delete enforce OCC", async () => {
      const now = backend.clock.now();
      await scoped.noteRepository.insert(makeBlankNote(1, userId(1), now));

      const first = await scoped.noteRepository.findById(noteId(1));
      if (first === null || first.entity.lifecycle !== "active") {
        throw new Error("seeded note missing");
      }
      const renamed = Note.rename(first.entity, "Renamed", now).entity;
      await scoped.noteRepository.save(renamed, first.expectedVersion);

      await expectConflict(
        scoped.noteRepository.save(renamed, first.expectedVersion),
        "OPTIMISTIC_LOCK_FAILURE",
      );
      await expectConflict(
        scoped.noteRepository.delete(noteId(1), first.expectedVersion),
        "OPTIMISTIC_LOCK_FAILURE",
      );

      const fresh = await scoped.noteRepository.findById(noteId(1));
      if (fresh === null) {
        throw new Error("seeded note missing");
      }
      await scoped.noteRepository.delete(noteId(1), fresh.expectedVersion);
      expect(await scoped.noteRepository.findById(noteId(1))).toBeNull();
    });

    it("ADP-note-012: listByIds returns only the ids present in this scope", async () => {
      const now = backend.clock.now();
      await scoped.noteRepository.insert(makeBlankNote(1, userId(1), now));
      await scoped.noteRepository.insert(makeBlankNote(2, userId(1), now));

      const listed = await scoped.noteRepository.listByIds([
        noteId(2),
        noteId(3),
      ]);
      expect(listed.map((note) => note.id)).toEqual([noteId(2)]);
    });

    it("ADP-note-013: listPurgeable returns trashed notes whose purgeAfter has arrived", async () => {
      const now = backend.clock.now();
      const active = makeBlankNote(1, userId(1), now);
      await scoped.noteRepository.insert(active);
      const trashed = Note.trash(makeBlankNote(2, userId(1), now), now).entity;
      await scoped.noteRepository.insert(trashed);

      expect(await scoped.noteRepository.listPurgeable(now, 10)).toEqual([]);

      const arrived = new Date(trashed.purgeAfter.getTime());
      const purgeable = await scoped.noteRepository.listPurgeable(arrived, 10);
      expect(purgeable.map((note) => note.id)).toEqual([noteId(2)]);
      expect(await scoped.noteRepository.listPurgeable(arrived, 0)).toEqual([]);
    });

    it("ADP-note-014/015: countByOwner and listByOwner respect owner and lifecycle filters", async () => {
      const now = backend.clock.now();
      await scoped.noteRepository.insert(makeBlankNote(1, userId(1), now));
      await scoped.noteRepository.insert(
        Note.trash(makeBlankNote(2, userId(1), now), now).entity,
      );

      const owner = NoteOwner.user(userId(1));
      expect(await scoped.noteRepository.countByOwner(owner, "active")).toBe(1);
      expect(await scoped.noteRepository.countByOwner(owner, "trashed")).toBe(
        1,
      );
      expect(await scoped.noteRepository.countByOwner(owner, "all")).toBe(2);
      expect(
        await scoped.noteRepository.countByOwner(
          NoteOwner.user(userId(2)),
          "all",
        ),
      ).toBe(0);

      const page = await scoped.noteRepository.listByOwner(owner, "all", {
        page: 1,
        limit: 1,
      });
      expect(page.items).toHaveLength(1);
      expect(page.count).toBe(2);
      const second = await scoped.noteRepository.listByOwner(owner, "all", {
        page: 2,
        limit: 1,
      });
      expect(second.items).toHaveLength(1);
      expect(second.items[0]?.id).not.toBe(page.items[0]?.id);
    });

    it("scope isolation: another scope's repository does not see this scope's notes", async () => {
      const now = backend.clock.now();
      await scoped.noteRepository.insert(makeBlankNote(1, userId(1), now));
      const other = backend.forScope(scopeOf(2));
      expect(await other.noteRepository.findById(noteId(1))).toBeNull();
    });

    it("trash retention: purgeAfter is trashedAt + 30 days", async () => {
      const now = backend.clock.now();
      const trashed = Note.trash(makeBlankNote(1, userId(1), now), now).entity;
      expect(trashed.purgeAfter.getTime() - trashed.trashedAt.getTime()).toBe(
        30 * DAY_MS,
      );
    });
  });
}
