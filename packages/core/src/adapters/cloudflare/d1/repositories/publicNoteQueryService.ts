import type { ShardPage } from "../../../../domain/common/pagination";
import type {
  PublicAuthorEntry,
  PublicNoteQueryService,
  PublicSearchCriteria,
  PublicSearchPage,
  SitemapEntry,
} from "../../../../domain/note/ports/publicNoteQueryService";
import { decodeOpaqueCursor, encodeOpaqueCursor } from "../../cursor";
import {
  ownerColumns,
  PUBLIC_NOTE_SEARCH,
  summaryColumns,
  toPublicSummary,
} from "../../projection/noteSearchRow";
import {
  bodyHighlights,
  resolveKeyword,
  searchFrom,
  tagFilter,
  tagFilterBindings,
} from "../../projection/searchClauses";
import { databaseError } from "../../sql/errors";
import { date, text } from "../../sql/row";
import type { SqlSession } from "../../sql/session";
import { type SqlRow, type SqlValue, statement } from "../../sql/statement";

const PLANE = PUBLIC_NOTE_SEARCH;
const ROW = "ns";

/**
 * Only rows that are still public and still alive are visible. The
 * writer keeps every projected note so its generation vector stays
 * comparable, so the visibility rule of
 * `spec/database/index.md#public_note_search--public_note_search_tags--public_note_search_fts`
 * is enforced on the read side.
 */
const PUBLISHED = `${ROW}.visibility = 'public' AND ${ROW}.lifecycle = 'active'`;

/**
 * Everything about a query except where it is paused. A cursor replayed
 * against different conditions decodes against a different fingerprint
 * and is rejected, which is what stops a stale cursor from silently
 * returning a page of some other query.
 */
const searchFingerprint = (criteria: PublicSearchCriteria): string =>
  JSON.stringify({
    q: "publicSearch",
    keyword: criteria.keyword,
    tagNames: [...criteria.tagNames],
    owner:
      criteria.ownerFilter === null ? null : ownerColumns(criteria.ownerFilter),
    updatedWithin:
      criteria.updatedWithin === null
        ? null
        : [
            criteria.updatedWithin.from.getTime(),
            criteria.updatedWithin.toExclusive.getTime(),
          ],
  });

const positionOf = (
  cursor: string | null,
  fingerprint: string,
): string | null =>
  cursor === null ? null : decodeOpaqueCursor(cursor, fingerprint).after;

/**
 * Read side of the global public projection.
 *
 * Pages are keyset-ordered by `note_id` and never carry a total: one
 * request's work has to stay fixed as the plane is physically sharded,
 * so there are no page numbers and no exact counts to reconcile across
 * shards.
 */
export function createD1PublicNoteQueryService(
  session: SqlSession,
): PublicNoteQueryService {
  const page = async (
    context: string,
    sql: string,
    params: readonly SqlValue[],
    limit: number,
  ): Promise<Readonly<{ rows: readonly SqlRow[]; hasMore: boolean }>> => {
    const wanted = Math.max(0, limit);
    try {
      const rows = await session.query(
        statement(`${sql} LIMIT ?`, ...params, wanted + 1),
      );
      return { rows: rows.slice(0, wanted), hasMore: rows.length > wanted };
    } catch (cause) {
      throw databaseError(context, cause);
    }
  };

  return {
    async searchPublic(
      criteria: PublicSearchCriteria,
    ): Promise<PublicSearchPage> {
      const fingerprint = searchFingerprint(criteria);
      const after = positionOf(criteria.cursor, fingerprint);
      const { keyword, match } = resolveKeyword(criteria.keyword);
      const conditions: string[] = [];
      const params: SqlValue[] = [];

      if (match !== null) {
        conditions.push(`${PLANE.ftsTable} MATCH ?`);
        params.push(match);
      }
      conditions.push(PUBLISHED);
      if (criteria.ownerFilter !== null) {
        const owner = ownerColumns(criteria.ownerFilter);
        conditions.push(`${ROW}.owner_type = ?`, `${ROW}.owner_id = ?`);
        params.push(owner.type, owner.id);
      }
      if (criteria.updatedWithin !== null) {
        conditions.push(`${ROW}.updated_at >= ?`, `${ROW}.updated_at < ?`);
        params.push(
          criteria.updatedWithin.from.getTime(),
          criteria.updatedWithin.toExclusive.getTime(),
        );
      }
      if (criteria.tagNames.length > 0) {
        conditions.push(tagFilter(PLANE, ROW));
        params.push(...tagFilterBindings(criteria.tagNames));
      }
      if (after !== null) {
        conditions.push(`${ROW}.note_id > ?`);
        params.push(after);
      }

      const { rows, hasMore } = await page(
        "searching the public note projection",
        `SELECT ${summaryColumns(PLANE, ROW)} ${searchFrom(PLANE, ROW, match)}
         WHERE ${conditions.join(" AND ")}
         ORDER BY ${ROW}.note_id ASC`,
        params,
        criteria.limit,
      );
      const last = rows[rows.length - 1];
      const summaries = rows.map((row) => toPublicSummary(row, keyword));
      const fromBody = await bodyHighlights(session, PLANE, summaries, keyword);
      return {
        items: summaries.map((item) => {
          const highlighted = fromBody.get(item.id);
          return highlighted === undefined
            ? item
            : { ...item, highlightedExcerpt: highlighted };
        }),
        nextCursor:
          hasMore && last !== undefined
            ? encodeOpaqueCursor({
                fp: fingerprint,
                after: text(last, "note_id"),
              })
            : null,
        hasMore,
      };
    },

    async listPublicSitemapEntries(
      cursor: string | null,
      limit: number,
    ): Promise<ShardPage<SitemapEntry>> {
      const fingerprint = "publicSitemap";
      const after = positionOf(cursor, fingerprint);
      const { rows, hasMore } = await page(
        "listing public sitemap entries",
        `SELECT ${ROW}.note_id, ${ROW}.updated_at FROM ${PLANE.table} ${ROW}
         WHERE ${PUBLISHED} ${after === null ? "" : `AND ${ROW}.note_id > ?`}
         ORDER BY ${ROW}.note_id ASC`,
        after === null ? [] : [after],
        limit,
      );
      const last = rows[rows.length - 1];
      return {
        items: rows.map((row) => ({
          noteId: text(row, "note_id"),
          updatedAt: date(row, "updated_at"),
        })),
        nextCursor:
          hasMore && last !== undefined
            ? encodeOpaqueCursor({
                fp: fingerprint,
                after: text(last, "note_id"),
              })
            : null,
      };
    },

    /**
     * Enumerated by **owner**, not by author, so the population matches
     * what `/@:handle` lists; a user appears once, carrying the latest
     * `updated_at` among their public notes.
     */
    async listPublicAuthors(
      cursor: string | null,
      limit: number,
    ): Promise<ShardPage<PublicAuthorEntry>> {
      const fingerprint = "publicAuthors";
      const after = positionOf(cursor, fingerprint);
      const { rows, hasMore } = await page(
        "listing public authors",
        `SELECT ${ROW}.owner_id AS user_id, MAX(${ROW}.updated_at) AS updated_at
         FROM ${PLANE.table} ${ROW}
         WHERE ${PUBLISHED} AND ${ROW}.owner_type = 'user'
           ${after === null ? "" : `AND ${ROW}.owner_id > ?`}
         GROUP BY ${ROW}.owner_id
         ORDER BY ${ROW}.owner_id ASC`,
        after === null ? [] : [after],
        limit,
      );
      const last = rows[rows.length - 1];
      return {
        items: rows.map((row) => ({
          userId: text(row, "user_id"),
          updatedAt: date(row, "updated_at"),
        })),
        nextCursor:
          hasMore && last !== undefined
            ? encodeOpaqueCursor({
                fp: fingerprint,
                after: text(last, "user_id"),
              })
            : null,
      };
    },
  };
}
