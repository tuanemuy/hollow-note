import { NoteErrorCode } from "../errorCode";
import type { Excerpt, NoteHtml, PlainTextContent } from "../valueObject";

/**
 * `BusinessRuleError` code raised when an input exceeds
 * `HtmlProcessorLimit`. A resource ceiling is a rejection of the actor's
 * input, not a fault of the service, so it carries the `business` kind
 * like every other invariant violation — a bare `RangeError` has no
 * `toSerialized()` and reaches the transport boundary as an unclassified
 * fault.
 *
 * It is an alias of `NoteErrorCode.HtmlTooComplex` rather than a literal
 * of its own: the code reaches a person through the same dictionary
 * every other Note business code does, so a second spelling of it would
 * be one the display layer has no row for.
 */
export const HTML_PROCESSOR_TOO_COMPLEX = NoteErrorCode.HtmlTooComplex;

/**
 * Every code `process` can raise in Note's vocabulary, and the complete
 * set of them.
 *
 * A caller from another domain has to answer all of them in its own
 * vocabulary — Note's codes are in neither its error table nor the
 * advice the display dictionary gives for them (`storeMedia` is the one
 * such caller today, spec/usecases/storage.md#storeMedia). Declaring the
 * set here rather than restating it at each boundary is what keeps a
 * third code from being added without those boundaries seeing it.
 *
 * - `HTML_PROCESSOR_TOO_COMPLEX` — every resource ceiling refuses with
 *   this one code (spec/adr/013 「サニタイズは資源で有界である」).
 * - `NoteErrorCode.ContentTooLarge` — `NoteHtml` / `PlainTextContent` /
 *   `Excerpt`, the only Note values `process` builds, measure the
 *   *result* in UTF-8 bytes. The tree meter does not stand in for that:
 *   it charges a node's pre-escape length in UTF-16 code units, while
 *   the serializer writes `"` as `&quot;` and U+00A0 as `&nbsp;`.
 */
export const HTML_PROCESSOR_NOTE_ERROR_CODES: readonly string[] = [
  HTML_PROCESSOR_TOO_COMPLEX,
  NoteErrorCode.ContentTooLarge,
];

/**
 * The resource ceiling `process` holds itself to (spec/adr/013 「サニタイズ
 * は資源で有界である」).
 *
 * The point of these numbers is that sanitization costs a bounded amount
 * of CPU and memory *whatever shape the input has*, so no caller has to
 * argue that the markup it hands over cannot make an HTML parser
 * duplicate content. All but `maxNodes` are far above what a document
 * reachable through the 2,000,000-byte transport ceiling for a note body
 * can legitimately reach; `maxNodes` is the one a legitimate body can
 * meet, and its own entry below says what that buys. An input under
 * every ceiling is processed exactly as it was before the ceilings
 * existed — they are observations, never transformations.
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
 * - `maxNodes` bounds how many nodes the tree may hold, counted as the
 *   parser asks for them. It is the one ceiling here that a *legitimate*
 *   body can reach, and it is set from cost rather than from headroom:
 *   the parser moves each top-level node out of the parse root one at a
 *   time, so a flat tree costs the square of that count, and 50,000 nodes
 *   is where that square lands on the 0.25 s the same parser already
 *   spends on a body at the transport ceiling. Prose reaches the
 *   800,000-byte body ceiling at about 12,000 nodes, so an article has
 *   four times the room it needs; markup denser than ~16 bytes a node
 *   (200,000 bare `<br>`s) is refused, which is the trade this ceiling
 *   makes. The same count is what keeps the heading and unwrap walks —
 *   both linear in it — from reaching a stack or argument-count limit
 *   that would raise a `RangeError` instead of this code.
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
  maxNodes: 50_000,
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
 * `inlineStylesheets` folds fetched CSS into the body, so it applies the
 * same CSS rules `process` does before writing it — the sheet arrives
 * from a third-party origin and nothing downstream re-sanitizes what it
 * returns. The caller is not expected to run `process` again; it hands
 * over the raw sheet as fetched.
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
 * Every method also rejects an input it cannot process within
 * `HtmlProcessorLimit`, with
 * `BusinessRuleError(HTML_PROCESSOR_TOO_COMPLEX)`. "Broken HTML is
 * repaired, not rejected" is unchanged — what is refused there is not a
 * shape but a cost.
 *
 * `process` has a second refusal on top of that: it builds Note's value
 * objects, so a result past their own caps comes back as
 * `BusinessRuleError(NoteErrorCode.ContentTooLarge)`. The complete set
 * is `HTML_PROCESSOR_NOTE_ERROR_CODES`, which a caller outside Note
 * translates rather than enumerates for itself.
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
