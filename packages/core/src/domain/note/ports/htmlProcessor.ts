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
 * inside `<style>` are never assigned a path — edits addressing them
 * fall out as `pathNotFound` (spec/adr/013 bypass prevention).
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
 * Port definition only in the walking-skeleton slice — the adapter ships
 * with the import slice.
 *
 * Error contract: `SystemError(ExternalServiceError)` (unparseable);
 * broken HTML is repaired, not rejected.
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
