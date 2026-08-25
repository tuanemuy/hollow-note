import { beforeEach, describe, expect, it } from "vitest";
import type { NoteSearchCriteria } from "../../../domain/note/ports/localNoteQueryService";
import type { PublicSearchCriteria } from "../../../domain/note/ports/publicNoteQueryService";
import { NoteOwner } from "../../../domain/note/valueObject";
import type {
  ConformanceBackend,
  ScopedConformancePorts,
} from "../../conformance/backend";
import {
  at,
  makeProjectionEntry,
  scopeOf,
  userId,
} from "../../conformance/fixtures";
import { makeCloudflareConformanceBackend } from "./conformanceBackend";

/**
 * Edges of the FTS / highlight path that the shared suites do not reach.
 *
 * The memory backend answers these with naive substring matching over the
 * excerpt, so none of them is a port contract — they are properties of
 * this backend's index, of the two-statement read that keeps a page from
 * carrying every body, and of the collation between the two.
 */

const VERSION = {
  projectionRevision: 1,
  authorVersion: 1,
  workspaceVersion: 0,
} as const;

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

const publicCriteria = (
  overrides: Partial<PublicSearchCriteria> = {},
): PublicSearchCriteria => ({
  keyword: null,
  tagNames: [],
  ownerFilter: null,
  updatedWithin: null,
  cursor: null,
  limit: 10,
  ...overrides,
});

describe("cloudflare note search edges", () => {
  let backend: ConformanceBackend;
  let scoped: ScopedConformancePorts;

  beforeEach(async () => {
    backend = await makeCloudflareConformanceBackend();
    scoped = backend.forScope(scopeOf(1));
  });

  it("highlights a keyword the body spells with combining marks", async () => {
    // `が` as base + U+3099, which is how imported HTML often carries it.
    const decomposed = "\u304b\u3099っこうの記録";
    await scoped.localNoteProjectionWriter.replaceSnapshotIfNewer(
      makeProjectionEntry(1, userId(1), at("2026-01-10T00:00:00Z"), {
        title: "Diary",
        text: decomposed,
        excerpt: decomposed,
      }),
      [],
      VERSION,
    );

    const found = await scoped.localNoteQueryService.search(
      criteria({ keyword: "がっこう" }),
    );

    expect(found.items.map((item) => item.id)).toEqual(["note-001"]);
    // The index matched on the composed form, and so must the collation
    // that places the marks — otherwise the row comes back unhighlighted.
    expect(found.items[0]?.highlightedExcerpt).toBe(
      "<mark>\u304b\u3099っこう</mark>の記録",
    );
  });

  it("filters by a repeated tag name exactly as by a single one", async () => {
    await scoped.localNoteProjectionWriter.replaceSnapshotIfNewer(
      makeProjectionEntry(1, userId(1), at("2026-01-10T00:00:00Z"), {
        visibility: "public",
      }),
      [{ name: "Work", normalized: "work" }],
      VERSION,
    );
    await backend.publicNoteProjectionWriter.replaceSnapshotIfNewer(
      makeProjectionEntry(1, userId(1), at("2026-01-10T00:00:00Z"), {
        visibility: "public",
      }),
      [{ name: "Work", normalized: "work" }],
      { ...VERSION, routeVersion: 1 },
    );

    const local = await scoped.localNoteQueryService.search(
      criteria({ tagNames: ["work", "work"] }),
    );
    expect(local.items.map((item) => item.id)).toEqual(["note-001"]);

    const published = await backend.publicNoteQueryService.searchPublic(
      publicCriteria({ tagNames: ["work", "work"] }),
    );
    expect(published.items.map((item) => item.id)).toEqual(["note-001"]);
  });

  it("recovers a highlight from the body when the excerpt holds no match", async () => {
    await scoped.localNoteProjectionWriter.replaceSnapshotIfNewer(
      makeProjectionEntry(1, userId(1), at("2026-01-10T00:00:00Z"), {
        title: "Long note",
        excerpt: "opening lines with nothing to find",
        text: `${"padding ".repeat(20)}the roadmap decision${" tail".repeat(20)}`,
      }),
      [],
      VERSION,
    );

    const found = await scoped.localNoteQueryService.search(
      criteria({ keyword: "roadmap" }),
    );

    const highlighted = found.items[0]?.highlightedExcerpt;
    expect(highlighted).toContain("<mark>roadmap</mark>");
    // A window around the match, not the whole body.
    expect(highlighted?.length).toBeLessThan(250);
  });

  it("leaves a match past the scanned body prefix unhighlighted", async () => {
    await scoped.localNoteProjectionWriter.replaceSnapshotIfNewer(
      makeProjectionEntry(1, userId(1), at("2026-01-10T00:00:00Z"), {
        title: "Very long note",
        excerpt: "opening lines with nothing to find",
        text: `${"x".repeat(6000)} the roadmap decision`,
      }),
      [],
      VERSION,
    );

    const found = await scoped.localNoteQueryService.search(
      criteria({ keyword: "roadmap" }),
    );

    // The row still matches — only the mark is given up, and the view
    // falls back to the plain excerpt.
    expect(found.items.map((item) => item.id)).toEqual(["note-001"]);
    expect(found.items[0]?.highlightedExcerpt).toBeNull();
  });

  it("names both months when one UTC day straddles a local month boundary", async () => {
    await scoped.localNoteProjectionWriter.replaceSnapshotIfNewer(
      makeProjectionEntry(1, userId(1), at("2026-03-31T10:00:00Z"), {}),
      [],
      VERSION,
    );
    await scoped.localNoteProjectionWriter.replaceSnapshotIfNewer(
      makeProjectionEntry(2, userId(1), at("2026-03-31T20:00:00Z"), {}),
      [],
      VERSION,
    );

    // Both instants share a UTC day, which is the unit the read groups by;
    // in Tokyo the later one is already April.
    expect(
      await scoped.localNoteQueryService.listMonthsWithNotes(
        owner(),
        "Asia/Tokyo",
      ),
    ).toEqual([
      { year: 2026, month: 4 },
      { year: 2026, month: 3 },
    ]);
    expect(
      await scoped.localNoteQueryService.listMonthsWithNotes(owner(), "UTC"),
    ).toEqual([{ year: 2026, month: 3 }]);
  });
});
