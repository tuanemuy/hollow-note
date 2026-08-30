/**
 * Declaration-level CSS filtering for spec/adr/013.
 *
 * Two things are removed and nothing else: `position: fixed` / `sticky`
 * (Shadow DOM scopes selectors but not layout, so one such declaration
 * covers the whole public page) and `@import` (an external fetch that
 * `ExternalFetchPolicy` never sees). The unit is the declaration / the
 * at-rule, never the enclosing block — dropping a whole `<style>` for one
 * violation would erase the decoration the `preserve` mode exists to keep.
 *
 * The scanner is deliberately forgiving: unbalanced braces and unknown
 * at-rules are carried through rather than rejected, because the input is
 * arbitrary imported CSS and losing it is worse than keeping something
 * inert.
 */

export type CssRemoval = Readonly<{ name: string; reason: string }>;
export type ReportCssRemoval = (removal: CssRemoval) => void;

const POSITION_PROPERTY = /^(?:-[a-z]+-)?position$/i;
const VIEWPORT_ANCHORED_POSITION = /^(?:-[a-z]+-)?(?:fixed|sticky)$/i;
const AT_RULE_NAME = /^@([-\w]+)/;

const FIXED_POSITION_REASON =
  "position: fixed / sticky escapes the note body (spec/adr/013)";
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

const isRemovedDeclaration = (declaration: string): boolean => {
  const colon = declaration.indexOf(":");
  if (colon === -1) {
    return false;
  }
  const property = declaration.slice(0, colon).trim();
  if (!POSITION_PROPERTY.test(property)) {
    return false;
  }
  const value = declaration
    .slice(colon + 1)
    .replace(/!\s*important\s*$/i, "")
    .trim();
  return VIEWPORT_ANCHORED_POSITION.test(value);
};

const declarationProperty = (declaration: string): string => {
  const colon = declaration.indexOf(":");
  return colon === -1 ? declaration.trim() : declaration.slice(0, colon).trim();
};

const pushStatement = (
  text: string,
  parts: string[],
  report: ReportCssRemoval,
): void => {
  if (text.length === 0) {
    return;
  }
  if (text.startsWith("@")) {
    if (AT_RULE_NAME.exec(text)?.[1]?.toLowerCase() === "import") {
      report({ name: "@import", reason: IMPORT_REASON });
      return;
    }
    parts.push(`${text};`);
    return;
  }
  if (isRemovedDeclaration(text)) {
    report({
      name: declarationProperty(text),
      reason: FIXED_POSITION_REASON,
    });
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
    if (prelude.startsWith("@")) {
      const name = AT_RULE_NAME.exec(prelude)?.[1]?.toLowerCase();
      if (name === "import") {
        report({ name: "@import", reason: IMPORT_REASON });
        continue;
      }
    }
    parts.push(`${prelude}{${filterCss(body, report)}}`);
  }
  return parts.join("");
}
