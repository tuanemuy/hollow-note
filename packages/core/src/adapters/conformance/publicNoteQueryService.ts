import { beforeEach, describe, expect, it } from "vitest";
import type { PublicSearchCriteria } from "../../domain/note/ports/publicNoteQueryService";
import { expectValidation } from "./asserts";
import type { ConformanceBackend, MakeConformanceBackend } from "./backend";
import { at, makeProjectionEntry, userId } from "./fixtures";

/** Shared conformance suite for `PublicNoteQueryService` (ADP-note-025..027). */
export function describePublicNoteQueryServiceContract(
  backendName: string,
  makeBackend: MakeConformanceBackend,
): void {
  describe(`PublicNoteQueryService conformance [${backendName}]`, () => {
    let backend: ConformanceBackend;

    beforeEach(async () => {
      backend = await makeBackend();
      for (let n = 1; n <= 3; n += 1) {
        await backend.publicNoteProjectionWriter.replaceSnapshotIfNewer(
          makeProjectionEntry(n, userId(1), at(`2026-01-0${n}T00:00:00Z`), {
            visibility: "public",
          }),
          [],
          {
            projectionRevision: 1,
            authorVersion: 1,
            workspaceVersion: 0,
            routeVersion: 1,
          },
        );
      }
      // A private row must never surface through the public read side.
      await backend.publicNoteProjectionWriter.replaceSnapshotIfNewer(
        makeProjectionEntry(4, userId(2), at("2026-01-04T00:00:00Z"), {
          visibility: "private",
        }),
        [],
        {
          projectionRevision: 1,
          authorVersion: 1,
          workspaceVersion: 0,
          routeVersion: 1,
        },
      );
    });

    const criteria = (
      overrides: Partial<PublicSearchCriteria> = {},
    ): PublicSearchCriteria => ({
      keyword: null,
      tagNames: [],
      ownerFilter: null,
      updatedWithin: null,
      cursor: null,
      limit: 2,
      ...overrides,
    });

    it("ADP-note-025: searchPublic pages by opaque cursor without exact counts", async () => {
      const first = await backend.publicNoteQueryService.searchPublic(
        criteria(),
      );
      expect(first.items.map((item) => item.id)).toEqual([
        "note-001",
        "note-002",
      ]);
      expect(first.hasMore).toBe(true);
      expect(first.nextCursor).not.toBeNull();

      const second = await backend.publicNoteQueryService.searchPublic(
        criteria({ cursor: first.nextCursor }),
      );
      expect(second.items.map((item) => item.id)).toEqual(["note-003"]);
      expect(second.hasMore).toBe(false);
      expect(second.nextCursor).toBeNull();
    });

    it("ADP-note-025: a tampered or condition-changed cursor is rejected", async () => {
      const first = await backend.publicNoteQueryService.searchPublic(
        criteria(),
      );
      await expectValidation(
        backend.publicNoteQueryService.searchPublic(
          criteria({ cursor: "tampered" }),
        ),
        "INVALID_PAGINATION",
      );
      await expectValidation(
        backend.publicNoteQueryService.searchPublic(
          criteria({ cursor: first.nextCursor, keyword: "changed" }),
        ),
        "INVALID_PAGINATION",
      );
    });

    it("ADP-note-026: listPublicSitemapEntries enumerates public notes only", async () => {
      const page =
        await backend.publicNoteQueryService.listPublicSitemapEntries(null, 10);
      expect(page.items.map((entry) => entry.noteId)).toEqual([
        "note-001",
        "note-002",
        "note-003",
      ]);
      expect(page.nextCursor).toBeNull();
    });

    it("ADP-note-027: listPublicAuthors emits each owner once with the max updatedAt", async () => {
      const page = await backend.publicNoteQueryService.listPublicAuthors(
        null,
        10,
      );
      expect(page.items).toEqual([
        { userId: "user-1", updatedAt: at("2026-01-03T00:00:00Z") },
      ]);
    });
  });
}
