import { normalizeForSearch, searchRunsOf } from "./bigram";

/**
 * `highlightedExcerpt` for both query services
 * (`spec/database/index.md#ハイライトと抜粋の生成`).
 *
 * FTS5's `snippet()` / `highlight()` are deliberately unused: the index
 * is contentless and what it holds is the bigram stream
 * (`東京 京都 都庁`), which is not something a reader may be shown. So the
 * index answers *which* row matched and how strongly, and the position of
 * the match is recovered here from the raw projected columns.
 *
 * Collation runs on the first two preprocessing steps only — NFKC and
 * case folding, no bigrams — applied to both sides, so full-width, kana
 * width and case fold exactly as they do in search. Because the match is
 * a plain substring of the raw text while the index matches bigrams, the
 * two can disagree: a row that only matched on its title, or through a
 * bigram that straddles a punctuation boundary, yields `null` here and
 * the view falls back to the plain excerpt (ADR 011「既知の限界」).
 */

/** Characters of context kept around the first match in the body text. */
const WINDOW_LENGTH = 160;
const WINDOW_LEAD = 40;
const ELLIPSIS = "…";
/** A pathological keyword must not make one row's rendering unbounded. */
const MAX_MARKS = 64;

const escapeHtml = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

type Range = readonly [start: number, end: number];

/**
 * The normalized form of `source` together with, for each of its UTF-16
 * units, the span of the original text that produced it.
 *
 * NFKC changes length (`㍿` becomes four characters), so a position found
 * in the normalized string means nothing to the caller. Every range is
 * translated back through this map before it is used, which is what keeps
 * the returned fragment a slice of the text the user actually wrote.
 */
type PositionMap = Readonly<{
  normalized: string;
  starts: readonly number[];
  ends: readonly number[];
}>;

const mapPositions = (source: string): PositionMap => {
  let normalized = "";
  const starts: number[] = [];
  const ends: number[] = [];
  let offset = 0;
  for (const char of source) {
    const piece = normalizeForSearch(char);
    for (let i = 0; i < piece.length; i += 1) {
      starts.push(offset);
      ends.push(offset + char.length);
    }
    normalized += piece;
    offset += char.length;
  }
  return { normalized, starts, ends };
};

const rangesIn = (
  map: PositionMap,
  needles: readonly string[],
): readonly Range[] => {
  const found: Range[] = [];
  for (const needle of needles) {
    let from = 0;
    while (found.length < MAX_MARKS) {
      const at = map.normalized.indexOf(needle, from);
      if (at < 0) {
        break;
      }
      const start = map.starts[at];
      const end = map.ends[at + needle.length - 1];
      if (start !== undefined && end !== undefined) {
        found.push([start, end]);
      }
      from = at + needle.length;
    }
  }
  return merge(found);
};

const merge = (ranges: readonly Range[]): readonly Range[] => {
  const sorted = [...ranges].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const merged: Range[] = [];
  for (const range of sorted) {
    const last = merged[merged.length - 1];
    if (last !== undefined && range[0] <= last[1]) {
      merged[merged.length - 1] = [last[0], Math.max(last[1], range[1])];
      continue;
    }
    merged.push(range);
  }
  return merged;
};

const render = (
  source: string,
  ranges: readonly Range[],
  window: Range,
): string => {
  const [from, to] = window;
  let rendered = from > 0 ? ELLIPSIS : "";
  let cursor = from;
  for (const [start, end] of ranges) {
    if (end <= from || start >= to) {
      continue;
    }
    const markStart = Math.max(start, from);
    const markEnd = Math.min(end, to);
    rendered += escapeHtml(source.slice(cursor, markStart));
    rendered += `<mark>${escapeHtml(source.slice(markStart, markEnd))}</mark>`;
    cursor = markEnd;
  }
  rendered += escapeHtml(source.slice(cursor, to));
  return to < source.length ? `${rendered}${ELLIPSIS}` : rendered;
};

/**
 * An HTML fragment whose only markup is `<mark>`, or `null` when the
 * keyword cannot be located in either projected column.
 *
 * The excerpt is preferred; the body is only consulted when the excerpt
 * holds no match, and then a window is cut around the first one. Escaping
 * happens here rather than in the view because this is the single field
 * of `NoteSummary` rendered as HTML — the producer owes the escaping.
 */
export function highlightExcerpt(
  excerpt: string,
  text: string,
  keyword: string,
): string | null {
  const needles = searchRunsOf(keyword);
  if (needles.length === 0) {
    return null;
  }

  const inExcerpt = rangesIn(mapPositions(excerpt), needles);
  if (inExcerpt.length > 0) {
    return render(excerpt, inExcerpt, [0, excerpt.length]);
  }

  const inText = rangesIn(mapPositions(text), needles);
  const first = inText[0];
  if (first === undefined) {
    return null;
  }
  const from = Math.max(0, first[0] - WINDOW_LEAD);
  return render(text, inText, [
    from,
    Math.min(text.length, from + WINDOW_LENGTH),
  ]);
}
