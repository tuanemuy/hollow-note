/**
 * Write-time bigram preprocessing for the FTS5(unicode61) indexes
 * ([ADR 011](../../../../../spec/adr/011-bigram-search.md);
 * `spec/database/index.md#bigram-前処理` is the implementation canon).
 *
 * One pure function serves both sides — `bigramIndexText` builds what a
 * projection writer stores in the index, `bigramMatchExpression` builds
 * what a query matches against it. They must stay a single shared
 * implementation: a query preprocessed differently from the index finds
 * nothing, and because the index is contentless the only way to withdraw
 * a row is to re-derive the exact tokens that were put in
 * (`spec/database/index.md#note_search_fts`).
 *
 * Changing anything here invalidates every stored index row: the old
 * tokens can no longer be spelled, so the tables have to be recreated and
 * refilled by `rebuildNoteProjection`.
 */

/**
 * `spec/database/index.md#bigram-前処理` の CJK 文字クラス. Half-width
 * kana and full-width alphanumerics are absent on purpose — NFKC has
 * already resolved them by the time runs are split.
 */
const CJK_RANGES: readonly (readonly [number, number])[] = [
  [0x3005, 0x3006],
  [0x3040, 0x309f],
  [0x30a0, 0x30ff],
  [0x31f0, 0x31ff],
  [0x3400, 0x4dbf],
  [0x4e00, 0x9fff],
  [0xf900, 0xfaff],
];

const isCjk = (char: string): boolean => {
  const code = char.codePointAt(0);
  return (
    code !== undefined &&
    CJK_RANGES.some(([from, to]) => code >= from && code <= to)
  );
};

/**
 * Steps 1 and 2 of the preprocessing — NFKC then lower case. Exported
 * because highlighting collates against this stage alone (bigrams would
 * be meaningless there), and it has to be the *same* normalization the
 * index used or the two disagree on full-width and case folding.
 */
export const normalizeForSearch = (value: string): string =>
  value.normalize("NFKC").toLowerCase();

type SearchRun = Readonly<{ cjk: boolean; text: string }>;

/** Step 3 — consecutive CJK characters against everything else. */
const splitRuns = (normalized: string): readonly SearchRun[] => {
  const runs: SearchRun[] = [];
  let cjk = false;
  let chars: string[] = [];
  for (const char of normalized) {
    const charIsCjk = isCjk(char);
    if (chars.length > 0 && charIsCjk !== cjk) {
      runs.push({ cjk, text: chars.join("") });
      chars = [];
    }
    cjk = charIsCjk;
    chars.push(char);
  }
  if (chars.length > 0) {
    runs.push({ cjk, text: chars.join("") });
  }
  return runs;
};

/** Step 4 — overlapping bigrams, or the single character of a 1-char run. */
const bigramsOf = (run: string): readonly string[] => {
  const chars = [...run];
  if (chars.length < 2) {
    return chars;
  }
  const tokens: string[] = [];
  for (let i = 0; i + 1 < chars.length; i += 1) {
    tokens.push(`${chars[i]}${chars[i + 1]}`);
  }
  return tokens;
};

/**
 * Ceiling for the single bound value one FTS column is fed.
 *
 * Both planes cap one bound value at 2,000,000 bytes
 * (`spec/platform/index.md` 実上限), and bigramming inflates CJK text by
 * about 2.33x: a maximum-size Japanese body (800,000 bytes, ADR 017)
 * already lands at 93% of that cap, and NFKC expansions — `㍿` becomes
 * four characters — carry it past. Tokens beyond this budget are left
 * out of the index rather than failing the projection, because a failed
 * projection retries into quarantine and leaves the note permanently
 * unsearchable, while a truncated one is still found by its head.
 */
const MAX_INDEX_TEXT_BYTES = 1_800_000;

const utf8Length = (value: string): number => {
  let bytes = 0;
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
  }
  return bytes;
};

const WHITESPACE = /\s+/u;

/**
 * The units a run contributes to the index text: overlapping bigrams for
 * CJK, whitespace-delimited words for everything else.
 *
 * A non-CJK run is not emitted whole because whitespace is itself non-CJK,
 * so one run spans every word between two CJK stretches — an English body
 * is a single run. Emitting it as one unit would make the byte budget
 * all-or-nothing for that column, and a run that alone exceeds the budget
 * would leave the column with no index at all instead of its head.
 * `unicode61` splits on whitespace anyway, so the tokens it sees are
 * unchanged by cutting here.
 */
const indexUnitsOf = (run: SearchRun): readonly string[] =>
  run.cjk
    ? bigramsOf(run.text)
    : run.text.split(WHITESPACE).filter((word) => word.length > 0);

/**
 * The text a projection writer feeds one FTS column. CJK runs become
 * space-separated overlapping bigrams so `unicode61` sees each pair as
 * its own token; everything else passes through and is tokenized as
 * written.
 *
 * Pure, and it has to stay pure: the contentless index is withdrawn by
 * re-deriving the tokens that went in, so the same body — truncated or
 * not — must always produce the same string.
 */
export const bigramIndexText = (value: string): string => {
  const tokens: string[] = [];
  let bytes = 0;
  for (const run of splitRuns(normalizeForSearch(value))) {
    for (const token of indexUnitsOf(run)) {
      const size = utf8Length(token) + (tokens.length === 0 ? 0 : 1);
      if (bytes + size > MAX_INDEX_TEXT_BYTES) {
        return tokens.join(" ");
      }
      bytes += size;
      tokens.push(token);
    }
  }
  return tokens.join(" ");
};

/**
 * Runs of a keyword, normalized but not yet bigrammed — the units the
 * match expression ANDs together, and the needles the highlighter looks
 * for in the raw text.
 */
export const searchRunsOf = (keyword: string): readonly string[] =>
  splitRuns(normalizeForSearch(keyword))
    .map((run) => (run.cjk ? run.text : run.text.trim()))
    .filter((run) => run.length > 0);

// `unicode61` splits on everything that is not a letter, a digit or an
// underscore, so a query phrase is built from those pieces only. Feeding
// punctuation into a quoted phrase would leave FTS5 matching an empty
// token where the caller meant a word.
const NON_WORD = /[^\p{L}\p{N}_]+/u;

const quotePhrase = (phrase: string): string =>
  `"${phrase.replaceAll('"', '""')}"`;

/**
 * The FTS5 `MATCH` expression for a keyword, or `null` when nothing
 * survives preprocessing (the caller then treats the search as having no
 * keyword at all).
 *
 * Every run becomes one quoted phrase — which is also what neutralizes
 * FTS5's own operators, so a keyword is never a query language — and the
 * phrases are ANDed. Alphanumeric runs additionally get the prefix
 * operator, so `cloud` still finds `cloudflare` even though the middle of
 * a word cannot be reached.
 */
export const bigramMatchExpression = (keyword: string): string | null => {
  const terms: string[] = [];
  for (const run of splitRuns(normalizeForSearch(keyword))) {
    if (run.cjk) {
      terms.push(quotePhrase(bigramsOf(run.text).join(" ")));
      continue;
    }
    const words = run.text.split(NON_WORD).filter((word) => word.length > 0);
    if (words.length > 0) {
      terms.push(`${quotePhrase(words.join(" "))}*`);
    }
  }
  return terms.length === 0 ? null : terms.join(" AND ");
};
