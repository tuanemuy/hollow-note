import type { PaginationResult } from "../../../domain/common/pagination";
import type { DateRange, YearMonth } from "../../../domain/common/time";
import type {
  LocalNoteQueryService,
  NoteSearchCriteria,
  NoteSortKey,
  NoteSummary,
} from "../../../domain/note/ports/localNoteQueryService";
import { NoteOwner } from "../../../domain/note/valueObject";
import type { LocalProjectionRow, ScopeStore } from "../store";
import { compareStrings } from "../support";
import { dayKeyOf, wallClockOf } from "../timeZone";

const MIN_KEYWORD_LENGTH = 2;

const escapeHtml = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const highlight = (excerpt: string, keyword: string): string | null => {
  const index = excerpt.toLowerCase().indexOf(keyword.toLowerCase());
  if (index < 0) {
    return null;
  }
  const before = excerpt.slice(0, index);
  const match = excerpt.slice(index, index + keyword.length);
  const after = excerpt.slice(index + keyword.length);
  return `${escapeHtml(before)}<mark>${escapeHtml(match)}</mark>${escapeHtml(after)}`;
};

export const projectionRowToSummary = (
  row: LocalProjectionRow,
  keyword: string | null,
): NoteSummary => ({
  id: row.entry.noteId,
  title: row.entry.title,
  excerpt: row.entry.excerpt,
  highlightedExcerpt:
    keyword === null ? null : highlight(row.entry.excerpt, keyword),
  visibility: row.entry.visibility,
  contentStatus: row.entry.contentStatus,
  styleMode: row.entry.styleMode,
  ownerType: row.entry.owner.type,
  ownerId:
    row.entry.owner.type === "user"
      ? row.entry.owner.userId
      : row.entry.owner.workspaceId,
  createdBy: row.entry.createdBy,
  tagNames: row.tags.map((tag) => tag.name),
  hasSourceFile: row.entry.hasSourceFile,
  createdAt: row.entry.createdAt,
  updatedAt: row.entry.updatedAt,
  trashedAt: row.entry.trashedAt,
  purgeAfter: row.entry.purgeAfter,
});

const sorter = (
  sort: NoteSortKey,
): ((a: LocalProjectionRow, b: LocalProjectionRow) => number) => {
  switch (sort) {
    case "updatedAsc":
      return (a, b) =>
        a.entry.updatedAt.getTime() - b.entry.updatedAt.getTime() ||
        compareStrings(a.noteId, b.noteId);
    case "createdDesc":
      return (a, b) =>
        b.entry.createdAt.getTime() - a.entry.createdAt.getTime() ||
        compareStrings(b.noteId, a.noteId);
    case "createdAsc":
      return (a, b) =>
        a.entry.createdAt.getTime() - b.entry.createdAt.getTime() ||
        compareStrings(a.noteId, b.noteId);
    case "titleAsc":
      return (a, b) =>
        compareStrings(a.entry.title, b.entry.title) ||
        compareStrings(a.noteId, b.noteId);
    case "titleDesc":
      return (a, b) =>
        compareStrings(b.entry.title, a.entry.title) ||
        compareStrings(b.noteId, a.noteId);
    default:
      // `relevance` has no meaningful ranking without a scoring index —
      // fall back to recency, like `updatedDesc`.
      return (a, b) =>
        b.entry.updatedAt.getTime() - a.entry.updatedAt.getTime() ||
        compareStrings(b.noteId, a.noteId);
  }
};

export function createMemoryLocalNoteQueryService(
  scope: ScopeStore,
): LocalNoteQueryService {
  const ownedRows = (owner: NoteOwner): readonly LocalProjectionRow[] =>
    scope.localProjection
      .values()
      .filter((row) => NoteOwner.equals(row.entry.owner, owner));

  return {
    async search(
      criteria: NoteSearchCriteria,
    ): Promise<PaginationResult<NoteSummary>> {
      const keyword =
        criteria.keyword !== null &&
        criteria.keyword.length >= MIN_KEYWORD_LENGTH
          ? criteria.keyword
          : null;
      const matched = ownedRows(criteria.owner)
        .filter((row) => row.entry.lifecycle === criteria.lifecycle)
        .filter((row) => {
          if (keyword === null) {
            return true;
          }
          const needle = keyword.toLowerCase();
          return (
            row.entry.title.toLowerCase().includes(needle) ||
            row.entry.text.toLowerCase().includes(needle)
          );
        })
        .filter((row) =>
          criteria.tagNames.every((normalized) =>
            row.tags.some((tag) => tag.normalized === normalized),
          ),
        )
        .filter((row) => {
          if (criteria.createdWithin === null) {
            return true;
          }
          const createdAt = row.entry.createdAt.getTime();
          return (
            createdAt >= criteria.createdWithin.from.getTime() &&
            createdAt < criteria.createdWithin.toExclusive.getTime()
          );
        })
        .sort(sorter(criteria.sort));
      const start = (criteria.pagination.page - 1) * criteria.pagination.limit;
      return {
        items: matched
          .slice(start, start + criteria.pagination.limit)
          .map((row) => projectionRowToSummary(row, keyword)),
        count: matched.length,
      };
    },

    async listMonthsWithNotes(
      owner: NoteOwner,
      timeZone: string,
    ): Promise<readonly YearMonth[]> {
      const seen = new Map<string, YearMonth>();
      for (const row of ownedRows(owner)) {
        if (row.entry.lifecycle !== "active") {
          continue;
        }
        const wall = wallClockOf(row.entry.createdAt, timeZone);
        const month: YearMonth = { year: wall.year, month: wall.month };
        seen.set(`${month.year}-${month.month}`, month);
      }
      return [...seen.values()].sort(
        (a, b) => b.year - a.year || b.month - a.month,
      );
    },

    async countByDay(
      owner: NoteOwner,
      range: DateRange,
      timeZone: string,
    ): Promise<readonly Readonly<{ day: string; count: number }>[]> {
      const counts = new Map<string, number>();
      for (const row of ownedRows(owner)) {
        if (row.entry.lifecycle !== "active") {
          continue;
        }
        const createdAt = row.entry.createdAt.getTime();
        if (
          createdAt < range.from.getTime() ||
          createdAt >= range.toExclusive.getTime()
        ) {
          continue;
        }
        const day = dayKeyOf(row.entry.createdAt, timeZone);
        counts.set(day, (counts.get(day) ?? 0) + 1);
      }
      return [...counts.entries()]
        .map(([day, count]) => ({ day, count }))
        .sort((a, b) => compareStrings(a.day, b.day));
    },

    async countByContentStatus(
      owner: NoteOwner,
      status: "processing" | "awaitingIntegration" | "failed" | "ready",
    ): Promise<number> {
      return ownedRows(owner).filter(
        (row) =>
          row.entry.lifecycle === "active" &&
          row.entry.contentStatus === status,
      ).length;
    },
  };
}
