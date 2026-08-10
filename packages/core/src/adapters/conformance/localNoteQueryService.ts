import { beforeEach, describe, expect, it } from "vitest";
import type { NoteSearchCriteria } from "../../domain/note/ports/localNoteQueryService";
import { NoteOwner } from "../../domain/note/valueObject";
import type {
  ConformanceBackend,
  MakeConformanceBackend,
  ScopedConformancePorts,
} from "./backend";
import { at, makeProjectionEntry, scopeOf, userId } from "./fixtures";

/** Shared conformance suite for `LocalNoteQueryService` (ADP-note-021..024). */
export function describeLocalNoteQueryServiceContract(
  backendName: string,
  makeBackend: MakeConformanceBackend,
): void {
  describe(`LocalNoteQueryService conformance [${backendName}]`, () => {
    let backend: ConformanceBackend;
    let scoped: ScopedConformancePorts;

    beforeEach(async () => {
      backend = await makeBackend();
      scoped = backend.forScope(scopeOf(1));
    });

    const owner = () => NoteOwner.user(userId(1));

    const criteria = (
      overrides: Partial<NoteSearchCriteria> = {},
    ): NoteSearchCriteria => ({
      owner: owner(),
      lifecycle: "active",
      keyword: null,
      tagNames: [],
      createdWithin: null,
      sort: "updatedDesc",
      pagination: { page: 1, limit: 10 },
      ...overrides,
    });

    const seed = async (): Promise<void> => {
      await scoped.localNoteProjectionWriter.replaceSnapshotIfNewer(
        makeProjectionEntry(1, userId(1), at("2026-01-10T00:00:00Z"), {
          title: "Alpha meeting notes",
          text: "we discussed the roadmap",
          excerpt: "we discussed the roadmap",
        }),
        [{ name: "Work", normalized: "work" }],
        { projectionRevision: 1, authorVersion: 1, workspaceVersion: 0 },
      );
      await scoped.localNoteProjectionWriter.replaceSnapshotIfNewer(
        makeProjectionEntry(2, userId(1), at("2026-02-10T00:00:00Z"), {
          title: "Beta diary",
          text: "a quiet day",
          excerpt: "a quiet day",
        }),
        [],
        { projectionRevision: 1, authorVersion: 1, workspaceVersion: 0 },
      );
      await scoped.localNoteProjectionWriter.replaceSnapshotIfNewer(
        makeProjectionEntry(3, userId(1), at("2026-02-20T00:00:00Z"), {
          lifecycle: "trashed",
          trashedAt: at("2026-03-01T00:00:00Z"),
          purgeAfter: at("2026-03-31T00:00:00Z"),
        }),
        [],
        { projectionRevision: 1, authorVersion: 1, workspaceVersion: 0 },
      );
    };

    it("ADP-note-021: search returns empty results with a zero count on an empty projection", async () => {
      expect(await scoped.localNoteQueryService.search(criteria())).toEqual({
        items: [],
        count: 0,
      });
    });

    it("ADP-note-021: search filters by lifecycle, keyword, and tags with a total count", async () => {
      await seed();

      const active = await scoped.localNoteQueryService.search(criteria());
      expect(active.count).toBe(2);
      expect(active.items.map((item) => item.id)).toEqual([
        "note-002",
        "note-001",
      ]);

      const trashed = await scoped.localNoteQueryService.search(
        criteria({ lifecycle: "trashed" }),
      );
      expect(trashed.items.map((item) => item.id)).toEqual(["note-003"]);

      const keyword = await scoped.localNoteQueryService.search(
        criteria({ keyword: "roadmap" }),
      );
      expect(keyword.items.map((item) => item.id)).toEqual(["note-001"]);
      expect(keyword.items[0]?.highlightedExcerpt).toContain("<mark>");

      const tagged = await scoped.localNoteQueryService.search(
        criteria({ tagNames: ["work"] }),
      );
      expect(tagged.items.map((item) => item.id)).toEqual(["note-001"]);

      const period = await scoped.localNoteQueryService.search(
        criteria({
          createdWithin: {
            from: at("2026-02-01T00:00:00Z"),
            toExclusive: at("2026-03-01T00:00:00Z"),
          },
        }),
      );
      expect(period.items.map((item) => item.id)).toEqual(["note-002"]);
    });

    it("ADP-note-021: highlightedExcerpt escapes the projection's markup", async () => {
      const payload = '<script>alert(1)</script> & "quotes" about the roadmap';
      await scoped.localNoteProjectionWriter.replaceSnapshotIfNewer(
        makeProjectionEntry(4, userId(1), at("2026-04-01T00:00:00Z"), {
          title: "Injection",
          text: payload,
          excerpt: payload,
        }),
        [],
        { projectionRevision: 1, authorVersion: 1, workspaceVersion: 0 },
      );

      const found = await scoped.localNoteQueryService.search(
        criteria({ keyword: "roadmap" }),
      );
      const highlighted = found.items[0]?.highlightedExcerpt;
      // This is the one field the UI renders as HTML, so the producer —
      // not the consumer — owes the escaping.
      expect(highlighted).toContain("<mark>roadmap</mark>");
      expect(highlighted).toContain("&lt;script&gt;");
      expect(highlighted).toContain("&amp;");
      expect(highlighted).not.toContain("<script");
      // The raw excerpt is plain text and stays unescaped.
      expect(found.items[0]?.excerpt).toBe(payload);
    });

    it("ADP-note-021: sort keys and pagination behave deterministically", async () => {
      await seed();
      const asc = await scoped.localNoteQueryService.search(
        criteria({ sort: "createdAsc" }),
      );
      expect(asc.items.map((item) => item.id)).toEqual([
        "note-001",
        "note-002",
      ]);

      const paged = await scoped.localNoteQueryService.search(
        criteria({ pagination: { page: 2, limit: 1 } }),
      );
      expect(paged.items).toHaveLength(1);
      expect(paged.count).toBe(2);
    });

    it("ADP-note-022: listMonthsWithNotes groups active notes by viewer-local month", async () => {
      await seed();
      const months = await scoped.localNoteQueryService.listMonthsWithNotes(
        owner(),
        "UTC",
      );
      expect(months).toEqual([
        { year: 2026, month: 2 },
        { year: 2026, month: 1 },
      ]);
    });

    it("ADP-note-023: countByDay aggregates a half-open range in the viewer time zone", async () => {
      await seed();
      const counts = await scoped.localNoteQueryService.countByDay(
        owner(),
        {
          from: at("2026-01-01T00:00:00Z"),
          toExclusive: at("2026-03-01T00:00:00Z"),
        },
        "UTC",
      );
      expect(counts).toEqual([
        { day: "2026-01-10", count: 1 },
        { day: "2026-02-10", count: 1 },
      ]);
    });

    it("ADP-note-024: countByContentStatus counts by body state", async () => {
      await seed();
      expect(
        await scoped.localNoteQueryService.countByContentStatus(
          owner(),
          "ready",
        ),
      ).toBe(2);
      expect(
        await scoped.localNoteQueryService.countByContentStatus(
          owner(),
          "processing",
        ),
      ).toBe(0);
    });
  });
}
