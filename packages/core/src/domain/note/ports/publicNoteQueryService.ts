import type { ShardPage } from "@repo/core/domain/common/pagination";
import type { DateRange } from "@repo/core/domain/common/time";
import type { NoteOwner } from "../valueObject";
import type { NoteSummary } from "./localNoteQueryService";

export type PublicSearchCriteria = Readonly<{
  keyword: string | null;
  /** Normalized names. */
  tagNames: readonly string[];
  /** In-page search on a public owner page. */
  ownerFilter: NoteOwner | null;
  /** Against `note_search.updated_at`, resolved in UTC. */
  updatedWithin: DateRange | null;
  /** Opaque cursor (shard generation + per-shard keyset / rank). */
  cursor: string | null;
  limit: number;
}>;

export type PublicNoteSummary = NoteSummary &
  Readonly<{
    authorHandle: string | null;
    authorDisplayName: string;
    workspaceSlug: string | null;
    workspaceName: string | null;
  }>;

/**
 * Public search never returns an exact count or page numbers — one
 * request's work stays fixed across physical sharding.
 */
export type PublicSearchPage = Readonly<{
  items: readonly PublicNoteSummary[];
  nextCursor: string | null;
  hasMore: boolean;
}>;

export type SitemapEntry = Readonly<{ noteId: string; updatedAt: Date }>;

/** A user owning at least one public, active, personally-owned note. */
export type PublicAuthorEntry = Readonly<{ userId: string; updatedAt: Date }>;

/**
 * Read side over the global public projection only. Cursors are opaque
 * values carrying the query fingerprint and shard generation; condition
 * changes, unreadable values, and retired generations surface as
 * `ValidationError("INVALID_PAGINATION")`. They are **not authenticated**
 * — a cursor decides where a page starts, never what it may contain, so
 * the public visibility predicate is applied on every read whatever
 * cursor arrives, and no caller may treat one as a capability.
 * `listPublicAuthors` enumerates by **owner** (not author/created_by) so
 * its population matches the `/@:handle` listing, emitting each user once
 * with their max updatedAt.
 *
 * Error contract: `SystemError(DatabaseError)`,
 * `SystemError(TimeoutError)`.
 */
export interface PublicNoteQueryService {
  searchPublic(criteria: PublicSearchCriteria): Promise<PublicSearchPage>;
  listPublicSitemapEntries(
    cursor: string | null,
    limit: number,
  ): Promise<ShardPage<SitemapEntry>>;
  listPublicAuthors(
    cursor: string | null,
    limit: number,
  ): Promise<ShardPage<PublicAuthorEntry>>;
}
