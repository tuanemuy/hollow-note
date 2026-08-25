import type { PaginationResult } from "../../../../domain/common/pagination";
import type { DateRange, YearMonth } from "../../../../domain/common/time";
import type {
  LocalNoteQueryService,
  NoteSearchCriteria,
  NoteSortKey,
  NoteSummary,
} from "../../../../domain/note/ports/localNoteQueryService";
import type { NoteOwner } from "../../../../domain/note/valueObject";
import {
  LOCAL_NOTE_SEARCH,
  ownerColumns,
  toSummary,
} from "../../projection/noteSearchRow";
import {
  relevanceScore,
  resolveKeyword,
  searchFrom,
  tagFilter,
} from "../../projection/searchClauses";
import { dayKeyOf, wallClockOf } from "../../projection/viewerCalendar";
import { databaseError } from "../../sql/errors";
import { jsonList } from "../../sql/json";
import { date, int } from "../../sql/row";
import type { SqlSession } from "../../sql/session";
import { type SqlValue, statement } from "../../sql/statement";

const PLANE = LOCAL_NOTE_SEARCH;
const ROW = "ns";

/**
 * `ORDER BY` per sort key, tie-broken on `note_id` in the same direction
 * so a page boundary never depends on storage order.
 *
 * `relevance` is the one key no B-tree can serve: it is the `bm25`
 * ranking of the match, so it only exists when a keyword narrowed the
 * set, and without one it degrades to recency
 * (`spec/database/index.md#note_search`).
 */
const orderBy = (sort: NoteSortKey, ranked: boolean): string => {
  switch (sort) {
    case "updatedAsc":
      return `${ROW}.updated_at ASC, ${ROW}.note_id ASC`;
    case "createdDesc":
      return `${ROW}.created_at DESC, ${ROW}.note_id DESC`;
    case "createdAsc":
      return `${ROW}.created_at ASC, ${ROW}.note_id ASC`;
    case "titleAsc":
      return `${ROW}.title ASC, ${ROW}.note_id ASC`;
    case "titleDesc":
      return `${ROW}.title DESC, ${ROW}.note_id DESC`;
    case "relevance":
      return ranked
        ? `${relevanceScore(PLANE)} ASC, ${ROW}.note_id ASC`
        : `${ROW}.updated_at DESC, ${ROW}.note_id DESC`;
    default:
      return `${ROW}.updated_at DESC, ${ROW}.note_id DESC`;
  }
};

/**
 * Read side of one scope's local projection: the owner's own lists,
 * searches and calendars (ADR 009). Public search is not served from
 * here — it has its own index on the global plane.
 */
export function createScopeLocalNoteQueryService(
  session: SqlSession,
): LocalNoteQueryService {
  const ownedRows = async (
    owner: NoteOwner,
    extraSql: string,
    extraParams: readonly SqlValue[],
    projection: string,
  ) => {
    const columns = ownerColumns(owner);
    return session.query(
      statement(
        `SELECT ${projection} FROM ${PLANE.table}
         WHERE owner_type = ? AND owner_id = ? AND lifecycle = 'active' ${extraSql}`,
        columns.type,
        columns.id,
        ...extraParams,
      ),
    );
  };

  return {
    async search(
      criteria: NoteSearchCriteria,
    ): Promise<PaginationResult<NoteSummary>> {
      const { keyword, match } = resolveKeyword(criteria.keyword);
      const owner = ownerColumns(criteria.owner);
      const conditions: string[] = [];
      const params: SqlValue[] = [];

      if (match !== null) {
        conditions.push(`${PLANE.ftsTable} MATCH ?`);
        params.push(match);
      }
      conditions.push(
        `${ROW}.owner_type = ?`,
        `${ROW}.owner_id = ?`,
        `${ROW}.lifecycle = ?`,
      );
      params.push(owner.type, owner.id, criteria.lifecycle);

      if (criteria.createdWithin !== null) {
        conditions.push(`${ROW}.created_at >= ?`, `${ROW}.created_at < ?`);
        params.push(
          criteria.createdWithin.from.getTime(),
          criteria.createdWithin.toExclusive.getTime(),
        );
      }
      if (criteria.tagNames.length > 0) {
        conditions.push(tagFilter(PLANE, ROW));
        params.push(jsonList([...criteria.tagNames]), criteria.tagNames.length);
      }

      const body = `${searchFrom(PLANE, ROW, match)} WHERE ${conditions.join(" AND ")}`;
      try {
        const counted = await session.query(
          statement(`SELECT COUNT(*) AS total ${body}`, ...params),
        );
        const total = counted[0] === undefined ? 0 : int(counted[0], "total");
        if (total === 0) {
          return { items: [], count: 0 };
        }
        const rows = await session.query(
          statement(
            `SELECT ${ROW}.* ${body} ORDER BY ${orderBy(criteria.sort, match !== null)} LIMIT ? OFFSET ?`,
            ...params,
            criteria.pagination.limit,
            (criteria.pagination.page - 1) * criteria.pagination.limit,
          ),
        );
        return {
          items: rows.map((row) => toSummary(row, keyword)),
          count: total,
        };
      } catch (cause) {
        throw databaseError("searching the local note projection", cause);
      }
    },

    async listMonthsWithNotes(
      owner: NoteOwner,
      timeZone: string,
    ): Promise<readonly YearMonth[]> {
      const rows = await ownedRows(owner, "", [], "DISTINCT created_at");
      const months = new Map<string, YearMonth>();
      for (const row of rows) {
        const wall = wallClockOf(date(row, "created_at"), timeZone);
        months.set(`${wall.year}-${wall.month}`, {
          year: wall.year,
          month: wall.month,
        });
      }
      return [...months.values()].sort(
        (a, b) => b.year - a.year || b.month - a.month,
      );
    },

    async countByDay(
      owner: NoteOwner,
      range: DateRange,
      timeZone: string,
    ): Promise<readonly Readonly<{ day: string; count: number }>[]> {
      const rows = await ownedRows(
        owner,
        "AND created_at >= ? AND created_at < ?",
        [range.from.getTime(), range.toExclusive.getTime()],
        "created_at",
      );
      const counts = new Map<string, number>();
      for (const row of rows) {
        const day = dayKeyOf(date(row, "created_at"), timeZone);
        counts.set(day, (counts.get(day) ?? 0) + 1);
      }
      return [...counts.entries()]
        .map(([day, count]) => ({ day, count }))
        .sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
    },

    async countByContentStatus(
      owner: NoteOwner,
      status: "processing" | "awaitingIntegration" | "failed" | "ready",
    ): Promise<number> {
      const rows = await ownedRows(
        owner,
        "AND content_status = ?",
        [status],
        "COUNT(*) AS total",
      );
      return rows[0] === undefined ? 0 : int(rows[0], "total");
    },
  };
}
