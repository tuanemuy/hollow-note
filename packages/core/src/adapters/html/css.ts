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
 */

export type CssRemoval = Readonly<{ name: string; reason: string }>;
export type ReportCssRemoval = (removal: CssRemoval) => void;

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
  kind: "comment" | "string" | "escape";
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
 * The low-level lexical unit at `start`, or `null` when the character is
 * ordinary CSS syntax.
 *
 * The one place this module recognises a comment, a string or an escape.
 * Routing every scan through it is what makes the three rules hold in all
 * of them at once — see the note at the top of the file on why a scan
 * that honours only some of them is a hole rather than an inconsistency.
 */
const readLexeme = (input: string, start: number): Lexeme | null => {
  const char = input[start];
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
const canonicalize = (input: string): string => {
  let out = "";
  let i = 0;
  while (i < input.length) {
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
const scanTo = (input: string, start: number, stops: string): number => {
  let i = start;
  let depth = 0;
  while (i < input.length) {
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
const findBlockEnd = (input: string, openBrace: number): number => {
  let i = openBrace + 1;
  let depth = 1;
  while (i < input.length) {
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
const disallowedPositionProperty = (canonical: string): string | undefined => {
  const colon = scanTo(canonical, 0, ":");
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
 */
const pushStatement = (
  text: string,
  terminated: boolean,
  parts: string[],
  report: ReportCssRemoval,
): void => {
  if (text.length === 0) {
    return;
  }
  const emitted = terminated ? `${text};` : text;
  const canonical = canonicalize(text).trim();
  if (canonical.startsWith("@")) {
    if (isImportAtRule(canonical)) {
      report({ name: "@import", reason: IMPORT_REASON });
      return;
    }
    parts.push(emitted);
    return;
  }
  const property = disallowedPositionProperty(canonical);
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
 */
export function filterCss(input: string, report: ReportCssRemoval): string {
  const parts: string[] = [];
  let i = 0;
  while (i < input.length) {
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
    const stop = scanTo(input, i, ";{}");
    if (stop === -1) {
      pushStatement(input.slice(i).trim(), false, parts, report);
      break;
    }
    if (input[stop] !== "{") {
      // A `}` closing nothing terminates the statement just as a `;` does,
      // and is written back as one: a stop was found at all only because
      // no string or paren was left open before it, so the `;` cannot be
      // swallowed on the next pass.
      pushStatement(input.slice(i, stop).trim(), true, parts, report);
      i = stop + 1;
      continue;
    }
    const prelude = input.slice(i, stop).trim();
    const end = findBlockEnd(input, stop);
    const body = input.slice(stop + 1, end === -1 ? input.length : end);
    i = end === -1 ? input.length : end + 1;
    const canonicalPrelude = canonicalize(prelude).trim();
    if (canonicalPrelude.startsWith("@") && isImportAtRule(canonicalPrelude)) {
      report({ name: "@import", reason: IMPORT_REASON });
      continue;
    }
    parts.push(`${prelude}{${filterCss(body, report)}${end === -1 ? "" : "}"}`);
  }
  return parts.join("");
}
