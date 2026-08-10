import { beforeEach, describe, expect, it } from "vitest";
import { expectValidation } from "./asserts";
import type { ConformanceBackend, MakeConformanceBackend } from "./backend";
import { noteId, scopeOf, userId } from "./fixtures";

const HOUR_MS = 60 * 60 * 1000;

/** Shared conformance suite for `NoteRouteFanOutReader` (ADP-note-046..047). */
export function describeNoteRouteFanOutReaderContract(
  backendName: string,
  makeBackend: MakeConformanceBackend,
): void {
  describe(`NoteRouteFanOutReader conformance [${backendName}]`, () => {
    let backend: ConformanceBackend;

    beforeEach(async () => {
      backend = await makeBackend();
      for (let n = 1; n <= 3; n += 1) {
        await backend.noteRouteStore.reserveCreate({
          noteId: noteId(n),
          scope: scopeOf(1),
          createdBy: userId(1),
          operationId: `op-${n}`,
          expiresAt: new Date(backend.clock.now().getTime() + HOUR_MS),
        });
        await backend.noteRouteStore.activateCreate({
          noteId: noteId(n),
          operationId: `op-${n}`,
        });
      }
    });

    it("ADP-note-046: listByCreatedBy pages in NoteId order and resumes by cursor", async () => {
      const first = await backend.noteRouteFanOutReader.listByCreatedBy(
        userId(1),
        null,
        2,
      );
      expect(first.items.map((route) => route.noteId)).toEqual([
        noteId(1),
        noteId(2),
      ]);
      expect(first.nextCursor).not.toBeNull();

      const second = await backend.noteRouteFanOutReader.listByCreatedBy(
        userId(1),
        first.nextCursor,
        2,
      );
      expect(second.items.map((route) => route.noteId)).toEqual([noteId(3)]);
      expect(second.nextCursor).toBeNull();
    });

    it("ADP-note-046: a tampered cursor is rejected with INVALID_PAGINATION", async () => {
      await expectValidation(
        backend.noteRouteFanOutReader.listByCreatedBy(
          userId(1),
          "tampered-cursor",
          2,
        ),
        "INVALID_PAGINATION",
      );
    });

    it("ADP-note-046/047: a cursor from one query cannot be replayed against another", async () => {
      const first = await backend.noteRouteFanOutReader.listByCreatedBy(
        userId(1),
        null,
        2,
      );
      await expectValidation(
        backend.noteRouteFanOutReader.listByScope(
          scopeOf(1),
          first.nextCursor,
          2,
        ),
        "INVALID_PAGINATION",
      );
    });

    it("ADP-note-047: listByScope enumerates the scope's routes", async () => {
      const page = await backend.noteRouteFanOutReader.listByScope(
        scopeOf(1),
        null,
        10,
      );
      expect(page.items).toHaveLength(3);
      expect(page.nextCursor).toBeNull();

      const empty = await backend.noteRouteFanOutReader.listByScope(
        scopeOf(2),
        null,
        10,
      );
      expect(empty.items).toEqual([]);
    });

    it("ADP-note-046/047: enumerates committed routes (active / moving / purging) and skips reservations", async () => {
      const expiresAt = new Date(backend.clock.now().getTime() + HOUR_MS);
      const reserve = async (n: number): Promise<void> => {
        await backend.noteRouteStore.reserveCreate({
          noteId: noteId(n),
          scope: scopeOf(1),
          createdBy: userId(1),
          operationId: `op-${n}`,
          expiresAt,
        });
      };
      await reserve(4);
      await reserve(5);
      await backend.noteRouteStore.activateCreate({
        noteId: noteId(5),
        operationId: "op-5",
      });
      await backend.noteRouteStore.beginMove({
        noteId: noteId(5),
        expectedRouteVersion: 1,
        target: scopeOf(2),
        migrationId: "mig-5",
      });
      await reserve(6);
      await backend.noteRouteStore.activateCreate({
        noteId: noteId(6),
        operationId: "op-6",
      });
      await backend.noteRouteStore.beginPurge({
        noteId: noteId(6),
        scope: scopeOf(1),
        expectedRouteVersion: 1,
        operationId: "op-6",
      });

      // A note mid-move or mid-purge still owes its author-route redaction,
      // so the fan-out must not narrow to `active` the way `resolve` does.
      const byCreator = await backend.noteRouteFanOutReader.listByCreatedBy(
        userId(1),
        null,
        200,
      );
      expect(
        byCreator.items.map((route) => [route.noteId, route.state]),
      ).toEqual([
        [noteId(1), "active"],
        [noteId(2), "active"],
        [noteId(3), "active"],
        [noteId(5), "moving"],
        [noteId(6), "purging"],
      ]);

      const byScope = await backend.noteRouteFanOutReader.listByScope(
        scopeOf(1),
        null,
        200,
      );
      expect(byScope.items.map((route) => route.noteId)).toEqual([
        noteId(1),
        noteId(2),
        noteId(3),
        noteId(5),
        noteId(6),
      ]);
    });
  });
}
