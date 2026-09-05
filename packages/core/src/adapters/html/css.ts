/**
 * Declaration-level CSS filtering for spec/adr/013.
 *
 * Two things are removed and nothing else: a `position` whose value is not
 * on the allow list (Shadow DOM scopes selectors but not layout, so one
 * `fixed` declaration covers the whole public page) and `@import` (an
 * external fetch that `ExternalFetchPolicy` never sees). The unit is the
 * declaration / the at-rule, never the enclosing block — dropping a whole
 * `<style>` for one violation would erase the decoration the `preserve`
 * mode exists to keep.
 *
 * The scanner is deliberately forgiving: unbalanced braces and unknown
 * at-rules are carried through rather than rejected, because the input is
 * arbitrary imported CSS and losing it is worse than keeping something
 * inert. Carried through means written back as they were found — the
 * filter never supplies a `;` or a `}` the source did not have. Filtering
 * has to be a fixed point (`filterCss(filterCss(x)) === filterCss(x)`)
 * because a stored body is re-sanitized on every save, and a terminator
 * added to an unclosed construct is invisible to the next pass, which then
 * adds another.
 *
 * Every classification runs on a canonical copy of the statement rather
 * than on its source text, because a browser resolves comments and
 * identifier escapes before it sees a property name: `position/**\/:fixed`,
 * `position:\66 ixed` and `@\69 mport` are all effectively the two things
 * this module exists to remove.
 *
 * **Every scan in this module reads its input through `readLexeme`.** The
 * three low-level constructs a browser resolves before any of the syntax
 * above — a comment, a string, an escape — are recognised in exactly one
 * place, so a scan cannot know about one of them and not the others. An
 * escape in particular swallows what follows the `\` and is never syntax:
 * a scan that skipped the `\` would read the `"` of
 * `content:\";position:fixed` as opening a string, never find the `;`
 * that actually ends the declaration, and hand the whole run to the
 * classifier as one statement whose property is `content`.
 *
 * There is a fourth rule, and it is the one that suspends the first two:
 * inside an unquoted `url(`, a browser consumes code points straight to
 * the `)` (CSS Syntax § consume-a-url-token), so neither a comment nor a
 * string starts there. `background:url(x/*);position:fixed` ends its
 * first declaration at the `;` — a scan that read the `/*` as a comment
 * would run to the end of the input looking for a comment close, lose
 * that `;`, and let the overlay through as one `background` declaration. So
 * `readLexeme` returns the whole url-token as one lexeme too, honouring
 * only escapes inside it, and the ident it tests for `url` is the
 * escape-resolved one (`\75 rl(` is a url-token to a browser).
 *
 * The fifth rule ends a string without a closing quote: a raw newline
 * makes it a bad-string-token and is re-consumed as the next token, so
 * `content:"a⏎;position:fixed` is two declarations and the second one
 * applies. Hunting for the closing quote to the end of the input loses
 * that `;` and hands the overlay through as one `content` declaration.
 * The newline is part of what is written back, too: it is the only
 * thing ending that string, so trimming it off before the `;` re-opens
 * the string in the output and the rules after it — which the input had
 * — are swallowed into a value.
 *
 * Every scan is metered. Finding the end of a block re-reads that block,
 * so nesting multiplies the work per byte: unbounded, a `<style>` holding
 * `@media a{` twelve thousand times — 108 KB — costs 26 seconds and then
 * overflows the stack. Block nesting is capped, and
 * `CssBudget` carries what is left of the scan allowance of one
 * `HtmlProcessor.process` call; running out of either raises
 * `BusinessRuleError(HTML_PROCESSOR_TOO_COMPLEX)` rather than letting
 * the scan run to whatever the input asks for.
 */

import { BusinessRuleError } from "../../domain/error";
import {
  HTML_PROCESSOR_TOO_COMPLEX,
  HtmlProcessorLimit,
} from "../../domain/note/ports/htmlProcessor";

export type CssRemoval = Readonly<{ name: string; reason: string }>;
export type ReportCssRemoval = (removal: CssRemoval) => void;

/**
 * What is left of the scan allowance of one `process` call. Mutable and
 * shared by every `filterCss` call in that pass — a body with a thousand
 * `style` attributes is one budget, not a thousand.
 */
export type CssBudget = { steps: number };

export const createCssBudget = (): CssBudget => ({
  steps: HtmlProcessorLimit.maxCssScanSteps,
});

const tooComplex = (detail: string): BusinessRuleError<string> =>
  new BusinessRuleError(HTML_PROCESSOR_TOO_COMPLEX, detail);

/**
 * Charges one scan step: one position a scan advances over, which is not
 * the same as one character it reads. A comment, a string and a url-token
 * are one lexeme each however long they are, so a single 1.8 MB comment
 * costs one step, and every level of block nesting re-reads the block
 * below it while spending steps only on the positions it passes.
 *
 * The count is therefore a proxy for the work, not an upper bound on it.
 * What bounds the two factors it does not see is elsewhere: the length of
 * a lexeme by the length of the input, and how many times a byte is
 * re-read by `HtmlProcessorLimit.maxCssNestingDepth`. This meter is the
 * backstop over their product — it is what stops 300 KB inside 32 legal
 * levels of nesting.
 */
const spend = (budget: CssBudget): void => {
  budget.steps -= 1;
  if (budget.steps < 0) {
    throw tooComplex(
      `CSS scanning exceeded ${HtmlProcessorLimit.maxCssScanSteps} steps`,
    );
  }
};

const POSITION_PROPERTY = /^(?:-[a-z]+-)?position$/i;

/**
 * The only `position` values that survive. Judging the value with an allow
 * list rather than a deny list is what closes indirection for free: a
 * browser resolves `var()` / `env()` (and one day `attr()`) to a keyword
 * this module never sees, so `position: var(--x)` would slip a `fixed`
 * past any list of banned spellings. An unknown value is inert in the
 * browser anyway, so removing it costs no decoration.
 */
const ALLOWED_POSITION_VALUE =
  /^(?:static|relative|absolute|inherit|initial|revert|revert-layer|unset)$/i;

const AT_RULE_NAME = /^@([-\w]+)/;

const POSITION_REASON =
  "position outside static / relative / absolute escapes the note body (spec/adr/013)";
const IMPORT_REASON =
  "@import fetches outside ExternalFetchPolicy (spec/adr/013)";

const isWhitespace = (char: string): boolean =>
  char === " " ||
  char === "\t" ||
  char === "\n" ||
  char === "\r" ||
  char === "\f";

const skipString = (input: string, start: number): number => {
  const quote = input[start];
  let i = start + 1;
  while (i < input.length) {
    const char = input[i];
    if (char === "\\") {
      // The same escape rule as outside a string, which is what keeps a
      // `\"` from closing the string it is written inside.
      i = readEscape(input, i).next;
      continue;
    }
    if (char === quote) {
      return i + 1;
    }
    if (char === "\n" || char === "\r" || char === "\f") {
      // CSS Syntax § consume-a-string-token: a raw newline ends the
      // string as a *bad-string-token* and is re-consumed as the next
      // token. So `content:"a⏎;position:fixed` is two declarations to a
      // browser, and a scan that ran to the end of the input looking for
      // the closing quote would hand it over as one `content`
      // declaration and let the overlay through.
      return i;
    }
    i += 1;
  }
  return i;
};

const skipComment = (input: string, start: number): number => {
  const end = input.indexOf("*/", start + 2);
  return end === -1 ? input.length : end + 2;
};

const IDENT_CHAR = /^[-\w]$/;

/**
 * Stands in for an escape that resolved to something which is not an
 * identifier character. The browser treats such a character as part of the
 * identifier and never as syntax, so the canonical copy must not let it act
 * as a colon, a quote, or a bracket either.
 */
const OPAQUE_ESCAPE = "\uFFFF";

const isHexDigit = (char: string): boolean =>
  (char >= "0" && char <= "9") ||
  (char >= "a" && char <= "f") ||
  (char >= "A" && char <= "F");

const asIdentChar = (char: string): string =>
  IDENT_CHAR.test(char) || (char.codePointAt(0) ?? 0) >= 0x80
    ? char
    : OPAQUE_ESCAPE;

type Lexeme = Readonly<{
  kind: "comment" | "string" | "escape" | "url";
  /** What the canonical copy stands the lexeme in as. */
  canonical: string;
  /** Offset just past it. */
  next: number;
}>;

/** Resolves the escape starting at `start`, per CSS Syntax § consume-escape. */
const readEscape = (input: string, start: number): Lexeme => {
  let i = start + 1;
  let hex = "";
  while (i < input.length && hex.length < 6 && isHexDigit(input[i] as string)) {
    hex += input[i];
    i += 1;
  }
  if (hex.length > 0) {
    // A single whitespace character terminates a hex escape and belongs to
    // it, so `\66 ixed` is `fixed` and not `f ixed`.
    if (i < input.length && isWhitespace(input[i] as string)) {
      i += 1;
    }
    const codePoint = Number.parseInt(hex, 16);
    const resolved =
      codePoint === 0 || codePoint > 0x10ffff
        ? "\uFFFD"
        : String.fromCodePoint(codePoint);
    return { kind: "escape", canonical: asIdentChar(resolved), next: i };
  }
  const escaped = input[start + 1];
  return escaped === undefined
    ? { kind: "escape", canonical: OPAQUE_ESCAPE, next: start + 1 }
    : { kind: "escape", canonical: asIdentChar(escaped), next: start + 2 };
};

/**
 * The unquoted url-token starting at `start`, or `null`.
 *
 * Mirrors CSS Syntax § consume-a-url-token: an ident spelled `url`
 * (case-insensitively, **after** escapes resolve) followed by `(` opens a
 * token that runs to the `)` — or to the end of the input — with escapes
 * as the only thing read inside it. A quote after the `(` is the one
 * branch that stays a function token, since that is where the browser
 * starts tokenising again too.
 *
 * The ident is read forwards from `start` rather than backwards from the
 * `(`, so a caller that walks one position at a time meets it — but only
 * when `start` is where an ident may begin. Landing part-way into one
 * (`myurl(`) must not match: over-matching only ever makes the scan see
 * a terminator the browser hides, but the extra split costs the rest of
 * the rule — dropping `position:fixed` out of
 * `.a{background:myurl(a(b);position:fixed);color:red}` carries the `)`
 * away with it and leaves the reader an unclosed function token that
 * swallows `color:red`. An ident preceded by an ident character is a
 * function token to the browser, which tokenises comments and strings
 * inside it, so declining here is not a concession — it is the rule.
 */
const readUrlToken = (input: string, start: number): Lexeme | null => {
  const previous = input[start - 1];
  if (previous !== undefined && IDENT_CHAR.test(previous)) {
    return null;
  }
  let i = start;
  let name = "";
  while (i < input.length && name.length < 4) {
    const char = input[i] as string;
    if (char === "\\") {
      const lexeme = readEscape(input, i);
      name += lexeme.canonical;
      i = lexeme.next;
      continue;
    }
    if (!IDENT_CHAR.test(char)) {
      break;
    }
    name += char;
    i += 1;
  }
  if (name.toLowerCase() !== "url" || input[i] !== "(") {
    return null;
  }
  let body = i + 1;
  while (body < input.length && isWhitespace(input[body] as string)) {
    body += 1;
  }
  const first = input[body];
  if (first === '"' || first === "'") {
    return null;
  }
  let end = i + 1;
  while (end < input.length) {
    const char = input[end] as string;
    if (char === "\\") {
      end = readEscape(input, end).next;
      continue;
    }
    end += 1;
    if (char === ")") {
      break;
    }
  }
  return { kind: "url", canonical: input.slice(start, end), next: end };
};

/**
 * The low-level lexical unit at `start`, or `null` when the character is
 * ordinary CSS syntax.
 *
 * The one place this module recognises a comment, a string, an escape, or
 * an unquoted url-token. Routing every scan through it is what makes the
 * four rules hold in all of them at once — see the note at the top of the
 * file on why a scan that honours only some of them is a hole rather than
 * an inconsistency.
 */
const readLexeme = (input: string, start: number): Lexeme | null => {
  const char = input[start];
  // Before the escape branch: `\75 rl(` is a url-token, not an escape
  // followed by ordinary syntax.
  const url = readUrlToken(input, start);
  if (url !== null) {
    return url;
  }
  if (char === "/" && input[start + 1] === "*") {
    // A comment separates tokens, it does not join them: `pos/**/ition`
    // is two identifiers to the parser and must not collapse into one.
    return { kind: "comment", canonical: " ", next: skipComment(input, start) };
  }
  if (char === '"' || char === "'") {
    const next = skipString(input, start);
    return { kind: "string", canonical: input.slice(start, next), next };
  }
  if (char === "\\") {
    return readEscape(input, start);
  }
  return null;
};

/**
 * Comment-free, escape-resolved copy of a statement, used only to classify
 * it — never to emit it. Unescaping the emitted text would turn `\3c` into a
 * real `<` and let a `</style>` out of the raw text node the CSS lives in.
 */
const canonicalize = (input: string, budget: CssBudget): string => {
  let out = "";
  let i = 0;
  while (i < input.length) {
    spend(budget);
    const lexeme = readLexeme(input, i);
    if (lexeme !== null) {
      out += lexeme.canonical;
      i = lexeme.next;
      continue;
    }
    out += input[i] as string;
    i += 1;
  }
  return out;
};

/**
 * Index of the first `stops` character that is not inside a string,
 * comment, escape, or parenthesised group. Parens matter because
 * `url(a;b)` and `@supports (a: b)` both hide characters that would
 * otherwise look like a terminator.
 */
const scanTo = (
  input: string,
  start: number,
  stops: string,
  budget: CssBudget,
): number => {
  let i = start;
  let depth = 0;
  while (i < input.length) {
    spend(budget);
    const lexeme = readLexeme(input, i);
    if (lexeme !== null) {
      i = lexeme.next;
      continue;
    }
    const char = input[i] as string;
    if (char === "(") {
      depth += 1;
      i += 1;
      continue;
    }
    if (char === ")") {
      depth = Math.max(0, depth - 1);
      i += 1;
      continue;
    }
    if (depth === 0 && stops.includes(char)) {
      return i;
    }
    i += 1;
  }
  return -1;
};

/** Index just past the `}` matching the `{` at `openBrace`, or -1. */
const findBlockEnd = (
  input: string,
  openBrace: number,
  budget: CssBudget,
): number => {
  let i = openBrace + 1;
  let depth = 1;
  while (i < input.length) {
    spend(budget);
    const lexeme = readLexeme(input, i);
    if (lexeme !== null) {
      i = lexeme.next;
      continue;
    }
    const char = input[i] as string;
    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return i;
      }
    }
    i += 1;
  }
  return -1;
};

const isImportAtRule = (canonical: string): boolean =>
  AT_RULE_NAME.exec(canonical)?.[1]?.toLowerCase() === "import";

/**
 * The property of a `position` declaration whose value is not allowed, or
 * undefined when the canonical statement is not one. The separator is found
 * with the same scan the statement splitter uses, so what counts as a colon
 * here is what counts as one everywhere else in this module.
 */
const disallowedPositionProperty = (
  canonical: string,
  budget: CssBudget,
): string | undefined => {
  const colon = scanTo(canonical, 0, ":", budget);
  if (colon === -1) {
    return undefined;
  }
  const property = canonical.slice(0, colon).trim();
  if (!POSITION_PROPERTY.test(property)) {
    return undefined;
  }
  const value = canonical
    .slice(colon + 1)
    .replace(/!\s*important\s*$/i, "")
    .trim();
  return ALLOWED_POSITION_VALUE.test(value) ? undefined : property;
};

/**
 * Emits one statement, or drops it and reports why.
 *
 * `terminated` says whether the source actually ended the statement with a
 * `;`. Only then may one be written back. Supplying the terminator that
 * the source lacked is what breaks the fixed point: an unterminated string
 * or an unclosed `(` is exactly the state in which the scanner cannot find
 * a terminator, so the `;` lands *inside* that construct and the next pass
 * — this module runs again on its own output, in every path that
 * re-sanitizes a stored body — no longer sees it, appends another, and the
 * text grows by one character per save.
 *
 * `text` keeps whatever trailing whitespace the source had, because a
 * statement can be one a raw newline ended (`content:"a⏎`) and that
 * newline is the whole of what closed its string. Trimming it and then
 * writing the `;` leaves `content:"a;`, which re-opens the string over
 * everything after it: the rules the input still applied are swallowed
 * into a value, and nothing is reported, since the filter removed
 * nothing.
 */
const pushStatement = (
  text: string,
  terminated: boolean,
  parts: string[],
  report: ReportCssRemoval,
  budget: CssBudget,
): void => {
  if (text.length === 0) {
    return;
  }
  const emitted = terminated ? `${text};` : text;
  const canonical = canonicalize(text, budget).trim();
  if (canonical.startsWith("@")) {
    if (isImportAtRule(canonical)) {
      report({ name: "@import", reason: IMPORT_REASON });
      return;
    }
    parts.push(emitted);
    return;
  }
  const property = disallowedPositionProperty(canonical, budget);
  if (property !== undefined) {
    report({ name: property, reason: POSITION_REASON });
    return;
  }
  parts.push(emitted);
};

/**
 * Filters a block of CSS — a whole stylesheet, the body of an at-rule, or
 * the value of a `style` attribute. One function covers all three because
 * the grammar difference is only which of `;` and `{` shows up first.
 *
 * `budget` is the remaining scan allowance of the whole `process` call
 * and is spent, never reset, across every call made during that pass.
 * Recursion is bounded by `HtmlProcessorLimit.maxCssNestingDepth`, so the
 * stack depth this function reaches is a constant rather than a function
 * of the input.
 */
export function filterCss(
  input: string,
  report: ReportCssRemoval,
  budget: CssBudget,
): string {
  return filterBlock(input, report, budget, 0);
}

function filterBlock(
  input: string,
  report: ReportCssRemoval,
  budget: CssBudget,
  depth: number,
): string {
  if (depth > HtmlProcessorLimit.maxCssNestingDepth) {
    throw tooComplex(
      `CSS nests deeper than ${HtmlProcessorLimit.maxCssNestingDepth} blocks`,
    );
  }
  const parts: string[] = [];
  let i = 0;
  while (i < input.length) {
    spend(budget);
    const char = input[i] as string;
    if (isWhitespace(char)) {
      i += 1;
      continue;
    }
    const lexeme = readLexeme(input, i);
    if (lexeme?.kind === "comment") {
      // Only a comment can stand before a statement without belonging to
      // it. A string or an escape is the statement's own first token, so
      // it is left to `scanTo` below rather than skipped here.
      i = lexeme.next;
      continue;
    }
    if (char === "}") {
      // Unbalanced close: the enclosing block already consumed its own.
      i += 1;
      continue;
    }
    const stop = scanTo(input, i, ";{}", budget);
    if (stop === -1) {
      pushStatement(input.slice(i), false, parts, report, budget);
      break;
    }
    if (input[stop] !== "{") {
      // A `}` closing nothing terminates the statement just as a `;` does,
      // and is written back as one: a stop was found at all only because
      // no string or paren was left open before it, so the `;` cannot be
      // swallowed on the next pass.
      pushStatement(input.slice(i, stop), true, parts, report, budget);
      i = stop + 1;
      continue;
    }
    // Trailing whitespace stays here for the same reason it stays on a
    // statement: a prelude can end with the newline that closed a
    // bad-string (`.o"a⏎{…}`), and dropping it re-opens that string over
    // the block and everything after it.
    const prelude = input.slice(i, stop);
    const end = findBlockEnd(input, stop, budget);
    const body = input.slice(stop + 1, end === -1 ? input.length : end);
    i = end === -1 ? input.length : end + 1;
    const canonicalPrelude = canonicalize(prelude, budget).trim();
    if (canonicalPrelude.startsWith("@") && isImportAtRule(canonicalPrelude)) {
      report({ name: "@import", reason: IMPORT_REASON });
      continue;
    }
    parts.push(
      `${prelude}{${filterBlock(body, report, budget, depth + 1)}${
        end === -1 ? "" : "}"
      }`,
    );
  }
  return parts.join("");
}
