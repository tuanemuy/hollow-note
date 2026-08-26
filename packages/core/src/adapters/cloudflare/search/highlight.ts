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
 * width and case fold exactly as they do in search. The text side is
 * normalized one grapheme cluster at a time so a position in the result
 * can be mapped back, which agrees with the whole-string normalization of
 * the needle everywhere composition stays inside a cluster. Because the match is
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

/**
 * The unit the map normalizes one piece at a time. It has to be the
 * grapheme cluster, not the code point: NFKC composes a base character
 * with the combining marks that follow it (`か` + U+3099 becomes `が`),
 * so normalizing code point by code point would leave a decomposed body
 * unmatchable by a needle the whole-string normalization composed —
 * exactly the rows the index does match.
 */
const clusters = new Intl.Segmenter("und", { granularity: "grapheme" });

const CARRIAGE_RETURN = 0x0d;

/**
 * The end of the run of stand-alone ASCII units starting at `at`, which is
 * `at` itself when the unit there is not one.
 *
 * A unit below 0x80 is a whole grapheme cluster on its own unless it is a
 * CR (which binds a following LF) or the next unit is non-ASCII: every
 * other thing that extends a cluster — combining marks, ZWJ, spacing
 * marks, Hangul jamo, regional indicators, prepend characters — lies
 * outside ASCII. Such a run is also fixed by NFKC and lower-cases one unit
 * per unit, so the whole run maps onto its own lower case with each index
 * standing for itself, and the segmenter can be skipped over it.
 */
const asciiRunEnd = (source: string, at: number): number => {
  let end = at;
  while (end < source.length) {
    const code = source.charCodeAt(end);
    if (code >= 0x80 || code === CARRIAGE_RETURN) {
      break;
    }
    if (end + 1 < source.length && source.charCodeAt(end + 1) >= 0x80) {
      break;
    }
    end += 1;
  }
  return end;
};

/**
 * Shortest run worth leaving the segmenter for — re-entering it costs a
 * slice of the remaining text, so alternating scripts must not pay that per
 * character. The probe at the far end of the window rejects a short run in
 * constant time, since a run this long needs every one of those units to be
 * ASCII.
 */
const MIN_ASCII_RUN = 16;

const longAsciiRunEnd = (source: string, at: number): number =>
  at + MIN_ASCII_RUN <= source.length &&
  source.charCodeAt(at + MIN_ASCII_RUN - 1) < 0x80
    ? asciiRunEnd(source, at)
    : at;

const mapPositions = (source: string): PositionMap => {
  let normalized = "";
  const starts: number[] = [];
  const ends: number[] = [];
  let at = 0;
  while (at < source.length) {
    const runEnd = longAsciiRunEnd(source, at);
    if (runEnd - at >= MIN_ASCII_RUN) {
      normalized += source.slice(at, runEnd).toLowerCase();
      for (let i = at; i < runEnd; i += 1) {
        starts.push(i);
        ends.push(i + 1);
      }
      at = runEnd;
      continue;
    }
    const base = at;
    for (const { segment, index } of clusters.segment(source.slice(base))) {
      const start = base + index;
      if (longAsciiRunEnd(source, start) - start >= MIN_ASCII_RUN) {
        at = start;
        break;
      }
      const piece =
        segment.length === 1 && segment.charCodeAt(0) < 0x80
          ? segment.toLowerCase()
          : normalizeForSearch(segment);
      for (let i = 0; i < piece.length; i += 1) {
        starts.push(start);
        ends.push(start + segment.length);
      }
      normalized += piece;
      at = start + segment.length;
    }
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

const matchesIn = (source: string, keyword: string): readonly Range[] => {
  const needles = searchRunsOf(keyword);
  return needles.length === 0 ? [] : rangesIn(mapPositions(source), needles);
};

/**
 * An HTML fragment whose only markup is `<mark>`, or `null` when the
 * keyword is nowhere in the excerpt.
 *
 * Escaping happens here rather than in the view because this is the
 * single field of `NoteSummary` rendered as HTML — the producer owes the
 * escaping.
 */
export function highlightExcerpt(
  excerpt: string,
  keyword: string,
): string | null {
  const ranges = matchesIn(excerpt, keyword);
  return ranges.length === 0
    ? null
    : render(excerpt, ranges, [0, excerpt.length]);
}

/**
 * The same fragment cut from a body text, as a window around the first
 * match — the fallback for a row whose excerpt holds no match. The caller
 * decides how much of the body to offer; a match past what it read simply
 * yields `null`, which is the fallback the view already handles.
 */
export function highlightBody(text: string, keyword: string): string | null {
  const ranges = matchesIn(text, keyword);
  const first = ranges[0];
  if (first === undefined) {
    return null;
  }
  const from = Math.max(0, first[0] - WINDOW_LEAD);
  return render(text, ranges, [
    from,
    Math.min(text.length, from + WINDOW_LENGTH),
  ]);
}
