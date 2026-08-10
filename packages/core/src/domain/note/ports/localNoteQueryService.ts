import type {
  Pagination,
  PaginationResult,
} from "@repo/core/domain/common/pagination";
import type { DateRange, YearMonth } from "@repo/core/domain/common/time";
import type { NoteOwner } from "../valueObject";

export type NoteSortKey =
  | "updatedDesc"
  | "updatedAsc"
  | "createdDesc"
  | "createdAsc"
  | "titleAsc"
  | "titleDesc"
  | "relevance";

export type NoteSearchCriteria = Readonly<{
  owner: NoteOwner;
  lifecycle: "active" | "trashed";
  /** Effective at 2+ characters; callers pass `null` for shorter input. */
  keyword: string | null;
  /** AND match. Normalized (`TagName` rules) names. */
  tagNames: readonly string[];
  /** Month filters arrive resolved in the viewer's time zone. */
  createdWithin: DateRange | null;
  sort: NoteSortKey;
  pagination: Pagination;
}>;

/**
 * Rendering contract (spec/domains/note.md): `title` / `excerpt` /
 * `tagNames` are **plain text** — the view renders them as text.
 * `highlightedExcerpt` is an **HTML fragment** whose only tags are
 * `<mark>` (the producer escapes the source text before inserting
 * marks); it is the only field the view may render as HTML, and when it
 * is `null` the fallback to `excerpt` must switch back to plain-text
 * rendering.
 */
export type NoteSummary = Readonly<{
  id: string;
  title: string;
  excerpt: string;
  highlightedExcerpt: string | null;
  visibility: "private" | "unlisted" | "public";
  contentStatus: "processing" | "awaitingIntegration" | "failed" | "ready";
  styleMode: "default" | "preserve";
  ownerType: "user" | "workspace";
  ownerId: string;
  createdBy: string;
  /** Display names (pre-normalization); filter matching uses normalized names. */
  tagNames: readonly string[];
  hasSourceFile: boolean;
  createdAt: Date;
  updatedAt: Date;
  trashedAt: Date | null;
  purgeAfter: Date | null;
}>;

/**
 * Read side over the owner scope's local read model (ADR 009). Keyword
 * search uses the write-time bigram scheme (ADR 011): queries of 2+
 * characters are effective. Period filters are half-open
 * (`from <= x < toExclusive`), resolved in the viewer's time zone.
 *
 * Error contract: `SystemError(DatabaseError)`,
 * `SystemError(TimeoutError)`.
 */
export interface LocalNoteQueryService {
  search(criteria: NoteSearchCriteria): Promise<PaginationResult<NoteSummary>>;
  listMonthsWithNotes(
    owner: NoteOwner,
    timeZone: string,
  ): Promise<readonly YearMonth[]>;
  countByDay(
    owner: NoteOwner,
    range: DateRange,
    timeZone: string,
  ): Promise<readonly Readonly<{ day: string; count: number }>[]>;
  countByContentStatus(
    owner: NoteOwner,
    status: "processing" | "awaitingIntegration" | "failed" | "ready",
  ): Promise<number>;
}
