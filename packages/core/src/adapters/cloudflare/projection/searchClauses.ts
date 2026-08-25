import type { NoteSummary } from "../../../domain/note/ports/localNoteQueryService";
import { bigramMatchExpression } from "../search/bigram";
import { highlightBody } from "../search/highlight";
import { databaseError } from "../sql/errors";
import { inJsonList, jsonList } from "../sql/json";
import { text } from "../sql/row";
import type { SqlSession } from "../sql/session";
import { type SqlValue, statement } from "../sql/statement";
import type { NoteSearchPlane } from "./noteSearchRow";

/** ADR 011: 2 文字クエリは全検索で有効。1 文字は null 落としとする. */
const MIN_KEYWORD_LENGTH = 2;

/**
 * A keyword in the two forms a search needs it in: the `MATCH`
 * expression that selects rows, and the original text the highlighter
 * collates against. Both are `null` when the keyword is too short or
 * when preprocessing leaves no token — the search then runs as if no
 * keyword had been given, which is also why `highlightedExcerpt` is
 * `null` on those rows.
 */
export type ResolvedKeyword = Readonly<{
  keyword: string | null;
  match: string | null;
}>;

export const resolveKeyword = (raw: string | null): ResolvedKeyword => {
  if (raw === null || raw.length < MIN_KEYWORD_LENGTH) {
    return { keyword: null, match: null };
  }
  const match = bigramMatchExpression(raw);
  return match === null
    ? { keyword: null, match: null }
    : { keyword: raw, match };
};

/**
 * The `FROM` clause. With a keyword the FTS table leads and the body row
 * is joined on its rowid, which is the shape SQLite plans as an index
 * scan of the match rather than a table scan filtered by it.
 */
export const searchFrom = (
  plane: NoteSearchPlane,
  alias: string,
  match: string | null,
): string =>
  match === null
    ? `FROM ${plane.table} ${alias}`
    : `FROM ${plane.ftsTable} JOIN ${plane.table} ${alias} ON ${alias}.rowid = ${plane.ftsTable}.rowid`;

/**
 * AND filtering over normalized tag names, as relational division on the
 * dedicated table. The FTS `tag_names_fts` column deliberately has no
 * part in this: full-text matching is partial and tag filtering is exact,
 * and ADR 011 records why one index cannot serve both.
 *
 * Binds two parameters — the JSON list of names, then how many of them
 * must be present. Build both with `tagFilterBindings`.
 */
export const tagFilter = (plane: NoteSearchPlane, alias: string): string =>
  `(SELECT COUNT(DISTINCT t.normalized) FROM ${plane.tagsTable} t
      WHERE t.note_id = ${alias}.note_id AND ${inJsonList("t.normalized")}) = ?`;

/**
 * The two bindings `tagFilter` expects, over the distinct names only: the
 * count on the left of the comparison is `COUNT(DISTINCT …)`, so a
 * repeated name would raise the required count without ever being able to
 * raise the matched one and turn the filter into a guaranteed miss.
 */
export const tagFilterBindings = (
  tagNames: readonly string[],
): readonly SqlValue[] => {
  const distinct = [...new Set(tagNames)];
  return [jsonList(distinct), distinct.length];
};

/**
 * Column weights of `bm25`, in the FTS table's column order
 * (`title_fts`, `text_fts`, `tag_names_fts`). Title outranks tag names,
 * which outrank the body (`spec/database/index.md#note_search_fts`).
 * Lower is better, so `relevance` orders ascending.
 */
export const relevanceScore = (plane: NoteSearchPlane): string =>
  `bm25(${plane.ftsTable}, 5.0, 1.0, 3.0)`;

/**
 * How much of a body the highlighter is offered. A projected `text` runs
 * to 800,000 bytes (ADR 017) and the window rendered from it is 160
 * characters, so a page that read every body whole would move megabytes
 * to place a few marks. A match past this prefix yields no highlight,
 * which is the same `null` — and the same plain-excerpt fallback — that
 * ADR 011「既知の限界」 already gives a row matched only through its title
 * or across a token boundary.
 */
const HIGHLIGHT_SCAN_LENGTH = 4000;

/**
 * Highlights recovered from the body, keyed by note id, for the rows of
 * one page whose excerpt held no match.
 *
 * This is the only reason a search reads `text` at all, which is why it
 * is a second statement over just those ids instead of a column on the
 * page itself (`summaryColumns`).
 */
export async function bodyHighlights(
  session: SqlSession,
  plane: NoteSearchPlane,
  items: readonly NoteSummary[],
  keyword: string | null,
): Promise<ReadonlyMap<string, string>> {
  const found = new Map<string, string>();
  if (keyword === null) {
    return found;
  }
  const pending = items
    .filter((item) => item.highlightedExcerpt === null)
    .map((item) => item.id);
  if (pending.length === 0) {
    return found;
  }
  try {
    const rows = await session.query(
      statement(
        `SELECT note_id, substr(text, 1, ${HIGHLIGHT_SCAN_LENGTH}) AS body
         FROM ${plane.table} WHERE ${inJsonList("note_id")}`,
        jsonList(pending),
      ),
    );
    for (const row of rows) {
      const highlighted = highlightBody(text(row, "body"), keyword);
      if (highlighted !== null) {
        found.set(text(row, "note_id"), highlighted);
      }
    }
  } catch (cause) {
    throw databaseError("highlighting note bodies", cause);
  }
  return found;
}
