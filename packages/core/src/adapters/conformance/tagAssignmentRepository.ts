import { beforeEach, describe, expect, it } from "vitest";
import { isSystemError } from "../../application/errors";
import type { NoteId } from "../../domain/note/valueObject";
import { TagAssignment } from "../../domain/tag/tagAssignment";
import { expectConflict } from "./asserts";
import type {
  ConformanceBackend,
  MakeConformanceBackend,
  ScopedConformancePorts,
} from "./backend";
import { noteId, scopeOf, userId } from "./fixtures";

/**
 * Shared conformance suite for the delete side of
 * `TagAssignmentRepository` (ADP-tag-010, 012, 019): the immutable
 * insert with its `(tagId, noteId)` uniqueness, the per-note listing,
 * and the bounded per-note delete a note purge walks.
 */
export function describeTagAssignmentRepositoryContract(
  backendName: string,
  makeBackend: MakeConformanceBackend,
): void {
  describe(`TagAssignmentRepository conformance [${backendName}]`, () => {
    let backend: ConformanceBackend;
    let repository: ScopedConformancePorts["tagAssignmentRepository"];

    beforeEach(async () => {
      backend = await makeBackend();
      repository = backend.forScope(scopeOf(1)).tagAssignmentRepository;
    });

    const assignment = (n: number, tag: number, note: NoteId): TagAssignment =>
      TagAssignment.reconstruct({
        id: `assignment-${String(n).padStart(3, "0")}`,
        tagId: `tag-${tag}`,
        noteId: note,
        scopeType: "user",
        scopeId: userId(1),
        assignedBy: userId(1),
        assignedAt: backend.clock.now(),
      });

    it("ADP-tag-010: rejects a second assignment of the same tag to the same note", async () => {
      await repository.insert(assignment(1, 1, noteId(1)));

      await expectConflict(
        repository.insert(assignment(2, 1, noteId(1))),
        "ASSIGNMENT_ALREADY_EXISTS",
      );
      // The same tag on a different note, and a different tag on the
      // same note, are both legitimate.
      await repository.insert(assignment(3, 1, noteId(2)));
      await repository.insert(assignment(4, 2, noteId(1)));

      expect((await repository.listByNote(noteId(1))).map((a) => a.id)).toEqual(
        ["assignment-001", "assignment-004"],
      );
    });

    it("ADP-tag-010: answers a re-used assignment id with a fault, not the pair conflict", async () => {
      await repository.insert(assignment(1, 1, noteId(1)));

      // The two unique constraints of the table mean different things:
      // losing the `(tagId, noteId)` race is a conflict the caller can
      // accept, while minting the same id twice is a fault it must fix.
      // A backend that collapses them tells the caller to retry the one
      // that will never succeed.
      await expect(
        repository.insert(assignment(1, 2, noteId(2))),
      ).rejects.toSatisfy(isSystemError);
      expect(await repository.listByNote(noteId(2))).toEqual([]);
      expect((await repository.listByNote(noteId(1))).map((a) => a.id)).toEqual(
        ["assignment-001"],
      );
    });

    it("ADP-tag-012: lists one note's assignments by id, rehydrated whole", async () => {
      await repository.insert(assignment(2, 2, noteId(1)));
      await repository.insert(assignment(1, 1, noteId(1)));
      await repository.insert(assignment(3, 3, noteId(2)));

      const rows = await repository.listByNote(noteId(1));
      expect(rows.map((a) => a.id)).toEqual([
        "assignment-001",
        "assignment-002",
      ]);
      expect(rows[0]).toEqual(assignment(1, 1, noteId(1)));
      expect(await repository.listByNote(noteId(9))).toEqual([]);
    });

    it("ADP-tag-019: deletes at most `limit` assignments of one note and answers the count", async () => {
      for (let n = 1; n <= 5; n += 1) {
        await repository.insert(assignment(n, n, noteId(1)));
      }
      await repository.insert(assignment(6, 1, noteId(2)));

      // `limit <= 0` is the whole clause, not just `0`: a backend that
      // hands the bound to its driver unclamped answers a negative page
      // with everything, or with a driver fault.
      expect(await repository.deleteByNote(noteId(1), 0)).toBe(0);
      expect(await repository.deleteByNote(noteId(1), -1)).toBe(0);
      expect(await repository.listByNote(noteId(1))).toHaveLength(5);
      // A full page is what tells the caller to schedule another turn,
      // so the bound has to cut exactly at `limit`.
      expect(await repository.deleteByNote(noteId(1), 2)).toBe(2);
      expect((await repository.listByNote(noteId(1))).map((a) => a.id)).toEqual(
        ["assignment-003", "assignment-004", "assignment-005"],
      );

      expect(await repository.deleteByNote(noteId(1), 100)).toBe(3);
      expect(await repository.listByNote(noteId(1))).toEqual([]);
      // Nothing left is a normal answer, not an error — that is what
      // makes a redelivered purge a no-op.
      expect(await repository.deleteByNote(noteId(1), 100)).toBe(0);
      // Another note's assignment of the same tag is untouched.
      expect((await repository.listByNote(noteId(2))).map((a) => a.id)).toEqual(
        ["assignment-006"],
      );
    });
  });
}
