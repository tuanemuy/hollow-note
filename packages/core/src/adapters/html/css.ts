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
 * inert.
 *
 * Every classification runs on a canonical copy of the statement rather
 * than on its source text, because a browser resolves comments and
 * identifier escapes before it sees a property name: `position/**\/:fixed`,
 * `position:\66 ixed` and `@\69 mport` are all effectively the two things
 * this module exists to remove.
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
      i += 2;
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

/** Resolves the escape starting at `start`, per CSS Syntax § consume-escape. */
const readEscape = (
  input: string,
  start: number,
): Readonly<{ text: string; next: number }> => {
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
    return { text: asIdentChar(resolved), next: i };
  }
  const escaped = input[start + 1];
  return escaped === undefined
    ? { text: OPAQUE_ESCAPE, next: start + 1 }
    : { text: asIdentChar(escaped), next: start + 2 };
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
    const char = input[i] as string;
    if (char === "/" && input[i + 1] === "*") {
      // A comment separates tokens, it does not join them: `pos/**/ition`
      // is two identifiers to the parser and must not collapse into one.
      out += " ";
      i = skipComment(input, i);
      continue;
    }
    if (char === '"' || char === "'") {
      const end = skipString(input, i);
      out += input.slice(i, end);
      i = end;
      continue;
    }
    if (char === "\\") {
      const resolved = readEscape(input, i);
      out += resolved.text;
      i = resolved.next;
      continue;
    }
    out += char;
    i += 1;
  }
  return out;
};

/**
 * Index of the first `stops` character that is not inside a string,
 * comment, or parenthesised group. Parens matter because `url(a;b)` and
 * `@supports (a: b)` both hide characters that would otherwise look like
 * a terminator.
 */
const scanTo = (input: string, start: number, stops: string): number => {
  let i = start;
  let depth = 0;
  while (i < input.length) {
    const char = input[i] as string;
    if (char === "/" && input[i + 1] === "*") {
      i = skipComment(input, i);
      continue;
    }
    if (char === '"' || char === "'") {
      i = skipString(input, i);
      continue;
    }
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
    const char = input[i] as string;
    if (char === "/" && input[i + 1] === "*") {
      i = skipComment(input, i);
      continue;
    }
    if (char === '"' || char === "'") {
      i = skipString(input, i);
      continue;
    }
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

const pushStatement = (
  text: string,
  parts: string[],
  report: ReportCssRemoval,
): void => {
  if (text.length === 0) {
    return;
  }
  const canonical = canonicalize(text).trim();
  if (canonical.startsWith("@")) {
    if (isImportAtRule(canonical)) {
      report({ name: "@import", reason: IMPORT_REASON });
      return;
    }
    parts.push(`${text};`);
    return;
  }
  const property = disallowedPositionProperty(canonical);
  if (property !== undefined) {
    report({ name: property, reason: POSITION_REASON });
    return;
  }
  parts.push(`${text};`);
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
    if (char === "/" && input[i + 1] === "*") {
      i = skipComment(input, i);
      continue;
    }
    if (char === "}") {
      // Unbalanced close: the enclosing block already consumed its own.
      i += 1;
      continue;
    }
    const stop = scanTo(input, i, ";{}");
    if (stop === -1) {
      pushStatement(input.slice(i).trim(), parts, report);
      break;
    }
    if (input[stop] !== "{") {
      pushStatement(input.slice(i, stop).trim(), parts, report);
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
    parts.push(`${prelude}{${filterCss(body, report)}}`);
  }
  return parts.join("");
}
