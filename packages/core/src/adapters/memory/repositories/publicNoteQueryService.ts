import type { ShardPage } from "../../../domain/common/pagination";
import type {
  PublicAuthorEntry,
  PublicNoteQueryService,
  PublicNoteSummary,
  PublicSearchCriteria,
  PublicSearchPage,
  SitemapEntry,
} from "../../../domain/note/ports/publicNoteQueryService";
import { NoteOwner } from "../../../domain/note/valueObject";
import { decodeOpaqueCursor, encodeOpaqueCursor } from "../cursor";
import type { MemoryBackend, PublicProjectionRow } from "../store";
import { compareStrings } from "../support";
import { projectionRowToSummary } from "./localNoteQueryService";

const MIN_KEYWORD_LENGTH = 2;

const toPublicSummary = (
  row: PublicProjectionRow,
  keyword: string | null,
): PublicNoteSummary => ({
  ...projectionRowToSummary(row, keyword),
  authorHandle: row.entry.author.handle,
  authorDisplayName: row.entry.author.displayName,
  workspaceSlug: row.entry.workspace?.slug ?? null,
  workspaceName: row.entry.workspace?.name ?? null,
});

const searchFingerprint = (criteria: PublicSearchCriteria): string =>
  JSON.stringify({
    q: "publicSearch",
    keyword: criteria.keyword,
    tagNames: [...criteria.tagNames],
    owner:
      criteria.ownerFilter === null
        ? null
        : criteria.ownerFilter.type === "user"
          ? `user:${criteria.ownerFilter.userId}`
          : `workspace:${criteria.ownerFilter.workspaceId}`,
    updatedWithin:
      criteria.updatedWithin === null
        ? null
        : [
            criteria.updatedWithin.from.toISOString(),
            criteria.updatedWithin.toExclusive.toISOString(),
          ],
  });

export function createMemoryPublicNoteQueryService(
  backend: MemoryBackend,
): PublicNoteQueryService {
  const publicRows = (): readonly PublicProjectionRow[] =>
    backend.publicProjection
      .values()
      .filter(
        (row) =>
          row.entry.visibility === "public" && row.entry.lifecycle === "active",
      );

  return {
    async searchPublic(
      criteria: PublicSearchCriteria,
    ): Promise<PublicSearchPage> {
      const fingerprint = searchFingerprint(criteria);
      const after =
        criteria.cursor === null
          ? null
          : decodeOpaqueCursor(criteria.cursor, fingerprint).after;
      const keyword =
        criteria.keyword !== null &&
        criteria.keyword.length >= MIN_KEYWORD_LENGTH
          ? criteria.keyword
          : null;
      const matched = publicRows()
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
        .filter(
          (row) =>
            criteria.ownerFilter === null ||
            NoteOwner.equals(row.entry.owner, criteria.ownerFilter),
        )
        .filter((row) => {
          if (criteria.updatedWithin === null) {
            return true;
          }
          const updatedAt = row.entry.updatedAt.getTime();
          return (
            updatedAt >= criteria.updatedWithin.from.getTime() &&
            updatedAt < criteria.updatedWithin.toExclusive.getTime()
          );
        })
        .filter((row) => after === null || row.noteId > after)
        .sort((a, b) => compareStrings(a.noteId, b.noteId));
      const items = matched.slice(0, Math.max(0, criteria.limit));
      const last = items[items.length - 1];
      const hasMore = matched.length > items.length;
      return {
        items: items.map((row) => toPublicSummary(row, keyword)),
        nextCursor:
          hasMore && last !== undefined
            ? encodeOpaqueCursor({ fp: fingerprint, after: last.noteId })
            : null,
        hasMore,
      };
    },

    async listPublicSitemapEntries(
      cursor: string | null,
      limit: number,
    ): Promise<ShardPage<SitemapEntry>> {
      const fingerprint = "publicSitemap";
      const after =
        cursor === null ? null : decodeOpaqueCursor(cursor, fingerprint).after;
      const matched = publicRows()
        .filter((row) => after === null || row.noteId > after)
        .sort((a, b) => compareStrings(a.noteId, b.noteId));
      const items = matched.slice(0, Math.max(0, limit));
      const last = items[items.length - 1];
      return {
        items: items.map((row) => ({
          noteId: row.noteId,
          updatedAt: row.entry.updatedAt,
        })),
        nextCursor:
          matched.length > items.length && last !== undefined
            ? encodeOpaqueCursor({ fp: fingerprint, after: last.noteId })
            : null,
      };
    },

    async listPublicAuthors(
      cursor: string | null,
      limit: number,
    ): Promise<ShardPage<PublicAuthorEntry>> {
      const fingerprint = "publicAuthors";
      const after =
        cursor === null ? null : decodeOpaqueCursor(cursor, fingerprint).after;
      const byOwner = new Map<string, Date>();
      for (const row of publicRows()) {
        if (row.entry.owner.type !== "user") {
          continue;
        }
        const userId = row.entry.owner.userId;
        const existing = byOwner.get(userId);
        if (existing === undefined || existing < row.entry.updatedAt) {
          byOwner.set(userId, row.entry.updatedAt);
        }
      }
      const matched = [...byOwner.entries()]
        .filter(([userId]) => after === null || userId > after)
        .sort(([a], [b]) => compareStrings(a, b));
      const items = matched.slice(0, Math.max(0, limit));
      const last = items[items.length - 1];
      return {
        items: items.map(([userId, updatedAt]) => ({ userId, updatedAt })),
        nextCursor:
          matched.length > items.length && last !== undefined
            ? encodeOpaqueCursor({ fp: fingerprint, after: last[0] })
            : null,
      };
    },
  };
}
