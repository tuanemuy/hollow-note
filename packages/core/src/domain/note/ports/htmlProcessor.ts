import type { Excerpt, NoteHtml, PlainTextContent } from "../valueObject";

export type RemovedNode = Readonly<{
  kind: "element" | "attribute" | "url" | "css";
  name: string;
  reason: string;
}>;

export type ExternalReference = Readonly<{
  url: string;
  attribute: string;
  elementName: string;
}>;

/**
 * `path` addresses a text node by dot-separated 0-based child indices
 * from the body root (e.g. `"2.0.1"`), stable over `process` output.
 * `expected` is the string the node held before editing. Text nodes
 * inside `<style>` and `<script>` are never assigned a path — both carry
 * CSS / script source rather than prose — so edits addressing them fall
 * out as `pathNotFound` (spec/adr/013 bypass prevention).
 */
export type TextNodeEdit = Readonly<{
  path: string;
  expected: string;
  text: string;
}>;

export type SkippedEdit = Readonly<{
  path: string;
  reason: "pathNotFound" | "contentChanged";
}>;

export type EditTextNodesResult = Readonly<{
  html: NoteHtml;
  skipped: readonly SkippedEdit[];
}>;

export type ProcessedHtml = Readonly<{
  html: NoteHtml;
  text: PlainTextContent;
  excerpt: Excerpt;
  /** style element / stylesheet / meaningful style attribute present (pre-sanitize). */
  hasDecoration: boolean;
  headings: readonly Readonly<{
    level: number;
    text: string;
    anchorId: string;
  }>[];
  /** Allow-list report: everything removed by sanitization, not just named threats. */
  removed: readonly RemovedNode[];
}>;

/**
 * Sanitizes raw HTML per spec/adr/013 (the single application point of the
 * sanitize policy) and derives the persisted projections in one pass.
 * `extractExternalReferences` returns **all** attribute-based URL
 * references, including internal storage URLs — internal/external
 * splitting is the caller's job (`StorageUrlPolicy.isInternal`).
 * External stylesheet traces use the three `data-stylesheet-*` states
 * (spec/adr/014); only `data-stylesheet-href` is extraction-eligible.
 *
 * `extractExternalReferences` reports the *resource* attributes (`src` /
 * `srcset` / `poster`) and the stylesheet trace, not navigation targets
 * (`a href`, `cite`): `importExternalReferences` stores and repoints
 * everything it is handed, so a hyperlink in that set would be downloaded
 * and rewritten to a copy of the linked page.
 *
 * Headings are indexed by `anchorId`, and the same call guarantees the id
 * resolves in the returned `html` — a heading without a usable `id` is
 * given a generated one, because nothing downstream re-derives it.
 *
 * Error contract: `SystemError(ExternalServiceError)` (unparseable);
 * broken HTML is repaired, not rejected. The shipped adapter
 * (`adapters/html/htmlProcessor.ts`) is backed by a total HTML5 fragment
 * parser and therefore never reaches that branch; a backend whose parser
 * can fail must translate into it rather than leak a driver error.
 */
export interface HtmlProcessor {
  process(rawHtml: string): ProcessedHtml;
  extractExternalReferences(html: NoteHtml): readonly ExternalReference[];
  rewriteReferences(
    html: NoteHtml,
    replacements: ReadonlyMap<string, string>,
  ): NoteHtml;
  inlineStylesheets(
    html: NoteHtml,
    contents: ReadonlyMap<string, string>,
    unavailable: ReadonlySet<string>,
  ): NoteHtml;
  editTextNodes(
    html: NoteHtml,
    edits: readonly TextNodeEdit[],
  ): EditTextNodesResult;
}
