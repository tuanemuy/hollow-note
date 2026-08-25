import { bigramMatchExpression } from "../search/bigram";
import { inJsonList } from "../sql/json";
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
 * must be present.
 */
export const tagFilter = (plane: NoteSearchPlane, alias: string): string =>
  `(SELECT COUNT(DISTINCT t.normalized) FROM ${plane.tagsTable} t
      WHERE t.note_id = ${alias}.note_id AND ${inJsonList("t.normalized")}) = ?`;

/**
 * Column weights of `bm25`, in the FTS table's column order
 * (`title_fts`, `text_fts`, `tag_names_fts`). Title outranks tag names,
 * which outrank the body (`spec/database/index.md#note_search_fts`).
 * Lower is better, so `relevance` orders ascending.
 */
export const relevanceScore = (plane: NoteSearchPlane): string =>
  `bm25(${plane.ftsTable}, 5.0, 1.0, 3.0)`;
