import type { Excerpt, NoteHtml, PlainTextContent } from "../valueObject";

/**
 * `BusinessRuleError` code raised when an input exceeds
 * `HtmlProcessorLimit`. A resource ceiling is a rejection of the actor's
 * input, not a fault of the service, so it carries the `business` kind
 * like every other invariant violation — a bare `RangeError` has no
 * `toSerialized()` and reaches the transport boundary as an unclassified
 * fault.
 */
export const HTML_PROCESSOR_TOO_COMPLEX = "NOTE_HTML_TOO_COMPLEX";

/**
 * The resource ceiling `process` holds itself to (spec/adr/013 「サニタイズ
 * は資源で有界である」).
 *
 * The point of these numbers is that sanitization costs a bounded amount
 * of CPU and memory *whatever shape the input has*, so no caller has to
 * argue that the markup it hands over cannot make an HTML parser
 * duplicate content. Every one of them is far above what a document
 * reachable through the 2,000,000-byte transport ceiling for a note body
 * can legitimately reach, so an input under the ceiling is processed
 * exactly as it was before the ceiling existed.
 *
 * - `maxExpansionFactor` / `minExpandedBytes` / `maxExpandedBytes` bound
 *   the parse tree, measured as the length it would serialize to. HTML
 *   parsing never duplicates content except by re-constructing the active
 *   formatting elements (foster parenting / the adoption agency), so a
 *   tree more than four times its source is that duplication and nothing
 *   else — a legitimate 1,040,000-byte body measures 1.06× here. The
 *   floor keeps very short inputs, where implied tags are a large
 *   relative cost (`<table><tr><td>x` serializes to 2.8× its source),
 *   away from the factor; the ceiling is twice the transport ceiling, so
 *   the bound holds even for a caller that has no transport boundary.
 * - `maxNestingDepth` bounds every depth-first walk over the tree. Real
 *   documents nest in the tens; the value keeps the walks inside a few
 *   hundred stack frames, more than an order of magnitude below where a
 *   JavaScript stack gives out.
 * - `maxCssNestingDepth` bounds `@media` / rule nesting. Finding the end
 *   of a block re-reads that block, so depth is what turns CSS filtering
 *   quadratic; capping it makes the cost linear again.
 * - `maxCssScanSteps` is the backstop on the total low-level character
 *   scanning of one `process` call: four passes over every byte the
 *   transport ceiling admits.
 */
export const HtmlProcessorLimit = {
  maxExpansionFactor: 4,
  minExpandedBytes: 262_144,
  maxExpandedBytes: 4_000_000,
  maxNestingDepth: 256,
  maxCssNestingDepth: 32,
  maxCssScanSteps: 8_000_000,
} as const;

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
 *
 * The one input every method does reject is one that cannot be processed
 * within `HtmlProcessorLimit`:
 * `BusinessRuleError(HTML_PROCESSOR_TOO_COMPLEX)`. "Broken HTML is
 * repaired, not rejected" is unchanged — what is refused is not a shape
 * but a cost, and only above a ceiling no document reachable through the
 * body's own size limits comes near.
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
