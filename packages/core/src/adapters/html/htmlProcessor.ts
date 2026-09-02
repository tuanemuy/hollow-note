import type {
  DefaultTreeAdapterMap,
  DefaultTreeAdapterTypes,
  Token,
  TreeAdapter,
} from "parse5";
import { defaultTreeAdapter, parseFragment, serialize } from "parse5";
import { BusinessRuleError } from "../../domain/error";
import type {
  EditTextNodesResult,
  ExternalReference,
  HtmlProcessor,
  ProcessedHtml,
  RemovedNode,
  SkippedEdit,
  TextNodeEdit,
} from "../../domain/note/ports/htmlProcessor";
import {
  HTML_PROCESSOR_TOO_COMPLEX,
  HtmlProcessorLimit,
} from "../../domain/note/ports/htmlProcessor";
import {
  Excerpt,
  NoteHtml,
  PlainTextContent,
} from "../../domain/note/valueObject";
import {
  ALLOWED_ELEMENTS,
  ALLOWED_SVG_ATTRIBUTES,
  ALLOWED_SVG_ELEMENTS,
  BLOCK_LEVEL_ELEMENTS,
  DATA_URL_MIME_TYPES,
  DROP_WITH_CONTENT,
  ELEMENT_ATTRIBUTES,
  GLOBAL_ATTRIBUTE_PREFIXES,
  GLOBAL_ATTRIBUTES,
  HEADING_ELEMENTS,
  IMPORTED_STYLESHEET_ATTRIBUTE,
  NAVIGATION_SCHEMES,
  NAVIGATION_URL_ATTRIBUTES,
  RESOURCE_SCHEMES,
  RESOURCE_URL_ATTRIBUTES,
  SRCSET_ATTRIBUTES,
  STYLESHEET_HREF_ATTRIBUTE,
  UNAVAILABLE_STYLESHEET_ATTRIBUTE,
} from "./allowList";
import { type CssBudget, createCssBudget, filterCss } from "./css";

type Element = DefaultTreeAdapterTypes.Element;
type TextNode = DefaultTreeAdapterTypes.TextNode;
type ChildNode = DefaultTreeAdapterTypes.ChildNode;
type ParentNode = DefaultTreeAdapterTypes.ParentNode;
type DocumentFragment = DefaultTreeAdapterTypes.DocumentFragment;

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

/**
 * How many elements must carry a non-empty `style` attribute before the
 * body counts as decorated. ADR 007 says "意味のある量の `style` 属性" and
 * leaves the amount to the implementation: a converter emitting one
 * incidental `style` must not flip a Markdown import to `preserve`, while
 * hand-decorated HTML reaches this in the first paragraph. The value only
 * seeds the initial `styleMode`, which the user can change afterwards.
 */
const STYLE_ATTRIBUTE_DECORATION_THRESHOLD = 3;

const isElement = (node: ChildNode): node is Element => "tagName" in node;

const isTextNode = (node: ChildNode): node is TextNode =>
  node.nodeName === "#text";

const isSvg = (element: Element): boolean =>
  element.namespaceURI === SVG_NAMESPACE;

/**
 * The name as it was written in the source. In foreign content parse5
 * carries a namespace prefix beside the local name, and gives a bare
 * `xmlns` the *empty* prefix rather than none — so an empty prefix has to
 * read as "no prefix" here, or the attribute is reported to the user as
 * `:xmlns` and matches nothing in the allow list.
 */
const attributeName = (attribute: Token.Attribute): string =>
  attribute.prefix === undefined || attribute.prefix === ""
    ? attribute.name
    : `${attribute.prefix}:${attribute.name}`;

const readAttribute = (element: Element, name: string): string | null =>
  element.attrs.find((attribute) => attributeName(attribute) === name)?.value ??
  null;

const writeAttribute = (
  element: Element,
  name: string,
  value: string,
): void => {
  const existing = element.attrs.find(
    (attribute) => attributeName(attribute) === name,
  );
  if (existing === undefined) {
    element.attrs.push({ name, value });
    return;
  }
  existing.value = value;
};

/**
 * parse5's serializer decides raw-text serialization from a text node's
 * `parentNode`, so re-parenting has to be explicit: children lifted out
 * of an unwrapped element would otherwise still name it as their parent.
 */
const adopt = (parent: ParentNode, children: readonly ChildNode[]): void => {
  parent.childNodes = [...children];
  for (const child of children) {
    if (!("parentNode" in child)) {
      continue;
    }
    child.parentNode = parent;
  }
};

const textNode = (value: string, parent: ParentNode): TextNode => ({
  nodeName: "#text",
  value,
  parentNode: parent,
});

const walkElements = (
  nodes: readonly ChildNode[],
  visit: (element: Element) => void,
): void => {
  for (const node of nodes) {
    if (!isElement(node)) {
      continue;
    }
    visit(node);
    walkElements(node.childNodes, visit);
  }
};

// --- URL policy (spec/adr/013 「許可する URL スキーム」) -------------------

/**
 * Browsers ignore ASCII control characters and whitespace when they read
 * a URL's scheme, so `java&#10;script:alert(1)` navigates while a naive
 * prefix check sees a relative path. Strip them before deciding.
 */
const stripControls = (url: string): string =>
  // biome-ignore lint/suspicious/noControlCharactersInRegex: the control characters are the threat being removed.
  url.replace(/[\u0000-\u0020\u007f]/g, "");

/**
 * Scheme of a URL, or `null` when it has none (fragment, root-relative or
 * relative path).
 */
const schemeOf = (url: string): string | null => {
  const stripped = stripControls(url);
  const match = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(stripped);
  return match === null ? null : (match[1] as string).toLowerCase();
};

const isAllowedDataUrl = (url: string): boolean => {
  const stripped = stripControls(url);
  const match = /^data:([^;,]+)[;,]/i.exec(stripped);
  return (
    match !== null &&
    DATA_URL_MIME_TYPES.has((match[1] as string).toLowerCase())
  );
};

type UrlKind = "navigation" | "resource";

const isAllowedUrl = (url: string, kind: UrlKind): boolean => {
  const scheme = schemeOf(url);
  if (scheme === null) {
    return true;
  }
  if (kind === "navigation") {
    return NAVIGATION_SCHEMES.has(scheme);
  }
  return RESOURCE_SCHEMES.has(scheme) || isAllowedDataUrl(url);
};

/**
 * Splits a `srcset` by the HTML candidate rule rather than on commas: a
 * `data:` URL carries commas of its own, and splitting on them would turn
 * one allowed image into several malformed candidates.
 */
const parseSrcset = (
  value: string,
): readonly Readonly<{ url: string; descriptor: string }>[] => {
  const candidates: { url: string; descriptor: string }[] = [];
  let i = 0;
  while (i < value.length) {
    while (i < value.length && /[\s,]/.test(value[i] as string)) {
      i += 1;
    }
    if (i >= value.length) {
      break;
    }
    const start = i;
    while (i < value.length && !/\s/.test(value[i] as string)) {
      i += 1;
    }
    const raw = value.slice(start, i);
    if (raw.endsWith(",")) {
      candidates.push({ url: raw.replace(/,+$/, ""), descriptor: "" });
      continue;
    }
    while (i < value.length && /\s/.test(value[i] as string)) {
      i += 1;
    }
    const descriptorStart = i;
    while (i < value.length && value[i] !== ",") {
      i += 1;
    }
    candidates.push({
      url: raw,
      descriptor: value.slice(descriptorStart, i).trim(),
    });
    i += 1;
  }
  return candidates;
};

const formatSrcset = (
  candidates: readonly Readonly<{ url: string; descriptor: string }>[],
): string =>
  candidates
    .map(({ url, descriptor }) =>
      descriptor.length === 0 ? url : `${url} ${descriptor}`,
    )
    .join(", ");

// --- sanitization ---------------------------------------------------------

type Report = (removal: RemovedNode) => void;

const UNLISTED_ELEMENT_REASON =
  "element is not on the allow-list (spec/adr/013)";
const UNLISTED_ATTRIBUTE_REASON =
  "attribute is not on the allow-list (spec/adr/013)";
const EVENT_HANDLER_REASON = "event handler attribute (spec/adr/013)";
const SRCDOC_REASON =
  "srcdoc carries a second HTML document inside an attribute value (spec/adr/013)";
const EXTERNAL_SVG_REFERENCE_REASON =
  "svg reference must stay inside the document (spec/adr/013)";
const LINK_STYLESHEET_REASON =
  "link rel=stylesheet bypasses ExternalFetchPolicy; the trace is kept as an empty <style> (spec/adr/013)";

const relTokens = (element: Element): readonly string[] =>
  (readAttribute(element, "rel") ?? "").toLowerCase().split(/\s+/);

/**
 * Replaces `<link rel="stylesheet" href="…">` with the empty
 * `<style data-stylesheet-href="…">` trace at the same position, so the
 * cascade order survives and `importExternalReferences` can still see the
 * original URL after sanitization (spec/adr/013, spec/adr/014).
 */
const stylesheetTrace = (link: Element, parent: ParentNode): Element | null => {
  const href = (readAttribute(link, "href") ?? "").trim();
  if (href.length === 0 || !isAllowedUrl(href, "resource")) {
    return null;
  }
  return {
    nodeName: "style",
    tagName: "style",
    attrs: [{ name: STYLESHEET_HREF_ATTRIBUTE, value: href }],
    namespaceURI: link.namespaceURI,
    parentNode: parent,
    childNodes: [],
  };
};

/**
 * The two attributes ADR 013 refuses on *any* element. Reported even when
 * the element that carried them is itself being removed: `srcdoc` is
 * listed as separately non-allowed precisely because element-level removal
 * is what fails to see the HTML document inside an attribute value, so the
 * report has to name it rather than let `<iframe srcdoc>` read as one
 * finding.
 */
const reportUnconditionalAttributes = (
  element: Element,
  report: Report,
): void => {
  for (const attribute of element.attrs) {
    const lower = attributeName(attribute).toLowerCase();
    if (lower.startsWith("on")) {
      report({ kind: "attribute", name: lower, reason: EVENT_HANDLER_REASON });
    } else if (lower === "srcdoc") {
      report({ kind: "attribute", name: lower, reason: SRCDOC_REASON });
    }
  }
};

const sanitizeAttributes = (
  element: Element,
  report: Report,
  svg: boolean,
  budget: CssBudget,
): void => {
  const kept: Token.Attribute[] = [];
  const allowedForElement = ELEMENT_ATTRIBUTES.get(element.tagName);

  reportUnconditionalAttributes(element, report);

  for (const attribute of element.attrs) {
    const name = attributeName(attribute);
    const lower = name.toLowerCase();

    if (lower.startsWith("on") || lower === "srcdoc") {
      continue;
    }

    const isGlobal =
      GLOBAL_ATTRIBUTES.has(lower) ||
      GLOBAL_ATTRIBUTE_PREFIXES.some((prefix) => lower.startsWith(prefix));

    if (svg) {
      if (lower === "href" || lower === "xlink:href") {
        if (attribute.value.trim().startsWith("#")) {
          kept.push(attribute);
        } else {
          report({
            kind: "url",
            name: schemeOf(attribute.value) ?? "external",
            reason: EXTERNAL_SVG_REFERENCE_REASON,
          });
        }
        continue;
      }
      if (!isGlobal && !ALLOWED_SVG_ATTRIBUTES.has(name)) {
        report({
          kind: "attribute",
          name,
          reason: UNLISTED_ATTRIBUTE_REASON,
        });
        continue;
      }
    } else if (!isGlobal && allowedForElement?.has(lower) !== true) {
      report({
        kind: "attribute",
        name: lower,
        reason: UNLISTED_ATTRIBUTE_REASON,
      });
      continue;
    }

    if (lower === "style") {
      const filtered = filterCss(
        attribute.value,
        (removal) => report({ kind: "css", ...removal }),
        budget,
      );
      if (filtered.trim().length === 0) {
        continue;
      }
      kept.push({ ...attribute, value: filtered });
      continue;
    }

    if (!svg && SRCSET_ATTRIBUTES.has(lower)) {
      const candidates = parseSrcset(attribute.value).filter((candidate) => {
        if (isAllowedUrl(candidate.url, "resource")) {
          return true;
        }
        report({
          kind: "url",
          name: schemeOf(candidate.url) ?? "unknown",
          reason: `${lower} candidate uses a scheme outside the resource allow-list (spec/adr/013)`,
        });
        return false;
      });
      if (candidates.length === 0) {
        continue;
      }
      kept.push({ ...attribute, value: formatSrcset(candidates) });
      continue;
    }

    if (!svg) {
      const urlKind: UrlKind | null = NAVIGATION_URL_ATTRIBUTES.has(lower)
        ? "navigation"
        : RESOURCE_URL_ATTRIBUTES.has(lower)
          ? "resource"
          : null;
      if (urlKind !== null && !isAllowedUrl(attribute.value, urlKind)) {
        report({
          kind: "url",
          name: schemeOf(attribute.value) ?? "unknown",
          reason: `${lower} uses a scheme outside the ${urlKind} allow-list (spec/adr/013)`,
        });
        continue;
      }
    }

    kept.push(attribute);
  }

  element.attrs = kept;

  // `window.opener` would otherwise let the opened page rewrite ours.
  if (
    !svg &&
    element.tagName === "a" &&
    (readAttribute(element, "target") ?? "").toLowerCase() === "_blank"
  ) {
    const tokens = new Set(relTokens(element).filter((token) => token !== ""));
    tokens.add("noopener");
    tokens.add("noreferrer");
    writeAttribute(element, "rel", [...tokens].join(" "));
  }
};

const sanitizeNodes = (
  nodes: readonly ChildNode[],
  parent: ParentNode,
  report: Report,
  insideSvg: boolean,
  budget: CssBudget,
): ChildNode[] => {
  const out: ChildNode[] = [];
  for (const node of nodes) {
    out.push(...sanitizeNode(node, parent, report, insideSvg, budget));
  }
  return out;
};

/**
 * `insideSvg` says the node has an `<svg>` above it, which is not the
 * same as being in the SVG namespace: `desc`, `title` and
 * `foreignObject` are HTML integration points, so the parser resumes
 * *HTML* parsing under them and their children come back in the HTML
 * namespace. Judging each node by its own namespace would let the whole
 * HTML allow list in through `<desc>` — `<style>` included, which ADR
 * 013 deliberately keeps out of the SVG subset, and which an XML parser
 * then reads as SVG's own `style` element applying to the document.
 * Inside an `<svg>` the SVG subset is the only allow list there is.
 */
const sanitizeNode = (
  node: ChildNode,
  parent: ParentNode,
  report: Report,
  insideSvg: boolean,
  budget: CssBudget,
): ChildNode[] => {
  if (isTextNode(node)) {
    return [node];
  }
  if (!isElement(node)) {
    // Comments and doctypes carry no body content and no allow-list row.
    return [];
  }

  const svg = isSvg(node) || insideSvg;
  const name = node.tagName;

  if (!svg && name === "link") {
    const stylesheet = relTokens(node).includes("stylesheet");
    report({
      kind: "element",
      name,
      reason: stylesheet ? LINK_STYLESHEET_REASON : UNLISTED_ELEMENT_REASON,
    });
    if (!stylesheet) {
      return [];
    }
    const trace = stylesheetTrace(node, parent);
    return trace === null ? [] : [trace];
  }

  const allowed = svg
    ? ALLOWED_SVG_ELEMENTS.has(name)
    : ALLOWED_ELEMENTS.has(name);
  if (!allowed) {
    report({ kind: "element", name, reason: UNLISTED_ELEMENT_REASON });
    reportUnconditionalAttributes(node, report);
    if (svg || DROP_WITH_CONTENT.has(name)) {
      return [];
    }
    return sanitizeNodes(node.childNodes, parent, report, insideSvg, budget);
  }

  sanitizeAttributes(node, report, svg, budget);

  if (!svg && name === "style") {
    const source = node.childNodes
      .filter(isTextNode)
      .map((child) => child.value)
      .join("");
    const filtered = filterCss(
      source,
      (removal) => report({ kind: "css", ...removal }),
      budget,
    );
    adopt(node, filtered.length === 0 ? [] : [textNode(filtered, node)]);
    return [node];
  }

  adopt(node, sanitizeNodes(node.childNodes, node, report, svg, budget));
  return [node];
};

// --- derived projections --------------------------------------------------

/** ADR 007: judged on the input *before* sanitization removes `<link>`. */
const detectDecoration = (fragment: DocumentFragment): boolean => {
  let decorated = false;
  let styleAttributes = 0;
  walkElements(fragment.childNodes, (element) => {
    if (isSvg(element)) {
      return;
    }
    if (element.tagName === "style") {
      decorated = true;
    }
    if (
      element.tagName === "link" &&
      relTokens(element).includes("stylesheet")
    ) {
      decorated = true;
    }
    if ((readAttribute(element, "style") ?? "").trim().length > 0) {
      styleAttributes += 1;
    }
  });
  return decorated || styleAttributes >= STYLE_ATTRIBUTE_DECORATION_THRESHOLD;
};

const collapse = (value: string): string => value.replace(/\s+/g, " ").trim();

const extractText = (nodes: readonly ChildNode[]): string => {
  const parts: string[] = [];
  const visit = (node: ChildNode): void => {
    if (isTextNode(node)) {
      parts.push(node.value);
      return;
    }
    if (!isElement(node)) {
      return;
    }
    if (!isSvg(node) && node.tagName === "style") {
      return;
    }
    const block = BLOCK_LEVEL_ELEMENTS.has(node.tagName);
    if (block) {
      parts.push(" ");
    }
    for (const child of node.childNodes) {
      visit(child);
    }
    if (block) {
      parts.push(" ");
    }
  };
  for (const node of nodes) {
    visit(node);
  }
  return collapse(parts.join(""));
};

const slugify = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[\s/]+/g, "-")
    .replace(/[^\p{L}\p{N}_-]+/gu, "")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");

type Heading = Readonly<{ level: number; text: string; anchorId: string }>;

/**
 * Collects the table of contents and guarantees each entry resolves in the
 * body: `NoteBody` scrolls by `getElementById(anchorId)` inside the shadow
 * root, so a heading without a usable `id` is given a generated one here —
 * the only place that sees both the heading list and the HTML it indexes.
 */
const collectHeadings = (fragment: DocumentFragment): readonly Heading[] => {
  const taken = new Set<string>();
  walkElements(fragment.childNodes, (element) => {
    const id = (readAttribute(element, "id") ?? "").trim();
    if (id.length > 0) {
      taken.add(id);
    }
  });

  const claimed = new Set<string>();
  const headings: Heading[] = [];
  walkElements(fragment.childNodes, (element) => {
    if (isSvg(element) || !HEADING_ELEMENTS.has(element.tagName)) {
      return;
    }
    const text = extractText(element.childNodes);
    const own = (readAttribute(element, "id") ?? "").trim();
    let anchorId: string;
    if (own.length > 0 && !claimed.has(own)) {
      anchorId = own;
    } else {
      const base = slugify(text) || "section";
      let candidate = base;
      let suffix = 2;
      while (taken.has(candidate) || claimed.has(candidate)) {
        candidate = `${base}-${suffix}`;
        suffix += 1;
      }
      anchorId = candidate;
      writeAttribute(element, "id", anchorId);
    }
    claimed.add(anchorId);
    taken.add(anchorId);
    headings.push({
      level: Number.parseInt(element.tagName.slice(1), 10),
      text,
      anchorId,
    });
  });
  return headings;
};

// --- reference walking ----------------------------------------------------

/**
 * Whether the value names a resource the import / orphan-collection paths
 * can act on. Fragments and the `data:` / `mailto:` / `tel:` schemes are
 * left out: they resolve to nothing fetchable and no stored object, so
 * reporting them would make every save look like it has references to
 * import. Internal versus external is *not* decided here — that split is
 * `StorageUrlPolicy.isInternal`'s, which is why relative URLs are in.
 */
const isResourceReference = (url: string): boolean => {
  if (url.length === 0 || url.startsWith("#")) {
    return false;
  }
  const scheme = schemeOf(url);
  return scheme === null || RESOURCE_SCHEMES.has(scheme);
};

type ReferenceVisitor = (reference: {
  url: string;
  attribute: string;
  elementName: string;
  replace: (url: string) => void;
}) => void;

/**
 * The one enumeration of attribute-based URL references, shared by
 * `extractExternalReferences` and `rewriteReferences` so the two can never
 * disagree about what counts as a reference.
 *
 * Resource attributes only (`src` / `srcset` / `poster`) plus the
 * stylesheet trace. Navigation targets (`a href`, `cite`) are deliberately
 * out: `importExternalReferences` stores every reference it is handed and
 * rewrites the attribute to the stored copy, so including a hyperlink
 * would download the linked page and repoint the link at a copy of it.
 * That step's own wording names the resource attributes
 * (spec/usecases/storage.md#importExternalReferences 手順 5).
 */
const visitReferences = (
  fragment: DocumentFragment,
  visit: ReferenceVisitor,
): void => {
  walkElements(fragment.childNodes, (element) => {
    if (isSvg(element)) {
      return;
    }
    for (const attribute of element.attrs) {
      const name = attributeName(attribute);
      if (element.tagName === "style" && name === STYLESHEET_HREF_ATTRIBUTE) {
        const url = attribute.value.trim();
        if (isResourceReference(url)) {
          visit({
            url,
            attribute: name,
            elementName: element.tagName,
            replace: (next) => {
              attribute.value = next;
            },
          });
        }
        continue;
      }
      if (SRCSET_ATTRIBUTES.has(name)) {
        const candidates = [...parseSrcset(attribute.value)];
        for (const [index, candidate] of candidates.entries()) {
          if (!isResourceReference(candidate.url)) {
            continue;
          }
          visit({
            url: candidate.url,
            attribute: name,
            elementName: element.tagName,
            replace: (next) => {
              candidates[index] = { ...candidate, url: next };
              attribute.value = formatSrcset(candidates);
            },
          });
        }
        continue;
      }
      if (!RESOURCE_URL_ATTRIBUTES.has(name)) {
        continue;
      }
      const url = attribute.value.trim();
      if (!isResourceReference(url)) {
        continue;
      }
      visit({
        url,
        attribute: name,
        elementName: element.tagName,
        replace: (next) => {
          attribute.value = next;
        },
      });
    }
  });
};

// --- text node paths ------------------------------------------------------

/**
 * `<style>` and `<script>` hold CSS / script source rather than prose, so
 * their children get no path at all — that is what keeps the visual editor
 * from rewriting a stylesheet and re-injecting `position: fixed` past the
 * CSS rules of ADR 013 (spec/domains/note.md).
 */
const isPathOpaque = (element: Element): boolean =>
  !isSvg(element) &&
  (element.tagName === "style" || element.tagName === "script");

const isElementNode = (node: ChildNode | DocumentFragment): node is Element =>
  "tagName" in node;

const resolveTextNode = (
  fragment: DocumentFragment,
  path: string,
): TextNode | null => {
  const segments = path.split(".");
  if (segments.length === 0 || segments.some((s) => !/^\d+$/.test(s))) {
    return null;
  }
  let current: ChildNode | DocumentFragment = fragment;
  for (const segment of segments) {
    if (!("childNodes" in current)) {
      return null;
    }
    if (isElementNode(current) && isPathOpaque(current)) {
      return null;
    }
    const child: ChildNode | undefined =
      current.childNodes[Number.parseInt(segment, 10)];
    if (child === undefined) {
      return null;
    }
    current = child;
  }
  return "nodeName" in current && current.nodeName === "#text"
    ? (current as TextNode)
    : null;
};

// --- adapter --------------------------------------------------------------

// `<tag>` + `</tag>` around the two copies of the name, and ` n="v"`.
const ELEMENT_MARKUP_BYTES = 5;
const ATTRIBUTE_MARKUP_BYTES = 4;
const COMMENT_MARKUP_BYTES = 7;

/**
 * How much deeper than `maxNestingDepth` the parser's stack of open
 * elements may get before the parse is abandoned. The stack is not the
 * tree — a fragment parse keeps its context element on it, and the
 * adoption agency holds elements there that are no longer ancestors — so
 * the parse-time counter is deliberately slack and only exists to stop a
 * run-away: parse5's own cost grows super-linearly with nesting, and
 * 50,000 `<div>`s (550 KB) took 21 seconds to build a tree that the
 * exact check below would then refuse. The boundary itself belongs to
 * `enforceNestingLimit`, which measures the tree.
 */
const OPEN_ELEMENT_SLACK = 8;

const nestsTooDeep = (): BusinessRuleError<string> =>
  new BusinessRuleError(
    HTML_PROCESSOR_TOO_COMPLEX,
    `HTML nests deeper than ${HtmlProcessorLimit.maxNestingDepth} levels`,
  );

const expansionAllowance = (inputLength: number): number =>
  Math.max(
    HtmlProcessorLimit.minExpandedBytes,
    Math.min(
      HtmlProcessorLimit.maxExpandedBytes,
      inputLength * HtmlProcessorLimit.maxExpansionFactor,
    ),
  );

/**
 * `defaultTreeAdapter`, metered.
 *
 * The tree is built by the parser, so a ceiling checked after
 * `parseFragment` returns would be checked after the memory has already
 * been spent: re-constructing the active formatting elements turns 128 KB
 * of `<template><tr><font …>` into a 15 MB tree and 200 MB of heap
 * before any code of ours runs. Charging each node as the parser asks
 * for it stops the parse itself, which is the only place the cost can be
 * refused.
 *
 * The unit is the length the node will serialize to, because that is what
 * bounds both the tree and the string built from it. Every method not
 * named here is `defaultTreeAdapter`'s, and below the allowance the two
 * adapters build the identical tree — the meter observes, it never
 * changes what is built.
 */
const createMeteredTreeAdapter = (
  allowance: number,
): TreeAdapter<DefaultTreeAdapterMap> => {
  let remaining = allowance;
  let open = 0;
  const spend = (cost: number): void => {
    remaining -= cost;
    if (remaining < 0) {
      throw new BusinessRuleError(
        HTML_PROCESSOR_TOO_COMPLEX,
        `HTML expands past ${allowance} bytes when parsed`,
      );
    }
  };
  return {
    ...defaultTreeAdapter,
    onItemPush() {
      open += 1;
      if (open > OPEN_ELEMENT_SLACK + HtmlProcessorLimit.maxNestingDepth) {
        throw nestsTooDeep();
      }
    },
    onItemPop() {
      open -= 1;
    },
    createElement(tagName, namespaceURI, attrs) {
      let cost = tagName.length * 2 + ELEMENT_MARKUP_BYTES;
      for (const attribute of attrs) {
        cost +=
          attribute.name.length +
          attribute.value.length +
          ATTRIBUTE_MARKUP_BYTES;
      }
      spend(cost);
      return defaultTreeAdapter.createElement(tagName, namespaceURI, attrs);
    },
    createCommentNode(data) {
      spend(data.length + COMMENT_MARKUP_BYTES);
      return defaultTreeAdapter.createCommentNode(data);
    },
    insertText(parentNode, text) {
      spend(text.length);
      defaultTreeAdapter.insertText(parentNode, text);
    },
    insertTextBefore(parentNode, text, referenceNode) {
      spend(text.length);
      defaultTreeAdapter.insertTextBefore(parentNode, text, referenceNode);
    },
  };
};

/**
 * Rejects a tree that nests past `maxNestingDepth`.
 *
 * Its own walk is an explicit stack, because the depth it exists to
 * refuse is exactly the depth that overflows a recursive one — 2,000
 * nested `<div>`s are 22 KB. Every other walk in this file, and parse5's
 * own serializer, is recursive and runs only after this returns, so the
 * limit is what keeps all of them inside a few hundred frames instead of
 * raising a `RangeError` that carries no `kind`.
 *
 * `<template>` content is walked too: the sanitizer drops `template`
 * whole, but the serializer descends into it, so it has to be inside the
 * bound as well.
 */
const enforceNestingLimit = (fragment: DocumentFragment): void => {
  const pending: { node: ChildNode; depth: number }[] = fragment.childNodes.map(
    (node) => ({ node, depth: 1 }),
  );
  while (pending.length > 0) {
    const entry = pending.pop() as { node: ChildNode; depth: number };
    if (entry.depth > HtmlProcessorLimit.maxNestingDepth) {
      throw nestsTooDeep();
    }
    if ("content" in entry.node) {
      for (const child of entry.node.content.childNodes) {
        pending.push({ node: child, depth: entry.depth + 1 });
      }
    }
    if ("childNodes" in entry.node) {
      for (const child of entry.node.childNodes) {
        pending.push({ node: child, depth: entry.depth + 1 });
      }
    }
  }
};

const parse = (html: string): DocumentFragment => {
  const fragment = parseFragment(html, {
    treeAdapter: createMeteredTreeAdapter(expansionAllowance(html.length)),
  });
  enforceNestingLimit(fragment);
  return fragment;
};

/**
 * The single application point of the sanitize policy (spec/adr/013).
 *
 * Backed by parse5's HTML5 fragment parser, which is total: malformed
 * markup is repaired into a tree rather than rejected, which is the
 * contract's "壊れた HTML は補正して返す". Sanitization then rebuilds the
 * tree against the closed sets of `allowList.ts` and re-serializes, so
 * the stored body is always parser output rather than attacker-shaped
 * source text.
 *
 * Stateless and pure — one instance may be shared by the whole process.
 */
export function createHtmlProcessor(): HtmlProcessor {
  return {
    process(rawHtml: string): ProcessedHtml {
      const fragment = parse(rawHtml);
      const hasDecoration = detectDecoration(fragment);

      const removed: RemovedNode[] = [];
      const seen = new Set<string>();
      // Identical removals fold into one row: the notice lists what the
      // policy took out, and a body with 200 `<script>`s says nothing more
      // than a body with one.
      const report: Report = (removal) => {
        const key = JSON.stringify([
          removal.kind,
          removal.name,
          removal.reason,
        ]);
        if (seen.has(key)) {
          return;
        }
        seen.add(key);
        removed.push(removal);
      };

      adopt(
        fragment,
        sanitizeNodes(
          fragment.childNodes,
          fragment,
          report,
          false,
          createCssBudget(),
        ),
      );
      const headings = collectHeadings(fragment);
      const text = extractText(fragment.childNodes);

      return {
        html: NoteHtml.create(serialize(fragment)),
        text: PlainTextContent.create(text),
        excerpt: Excerpt.fromText(text),
        hasDecoration,
        headings,
        removed,
      };
    },

    extractExternalReferences(html: NoteHtml): readonly ExternalReference[] {
      const references: ExternalReference[] = [];
      const seen = new Set<string>();
      visitReferences(parse(html), ({ url, attribute, elementName }) => {
        const key = JSON.stringify([url, attribute, elementName]);
        if (seen.has(key)) {
          return;
        }
        seen.add(key);
        references.push({ url, attribute, elementName });
      });
      return references;
    },

    rewriteReferences(
      html: NoteHtml,
      replacements: ReadonlyMap<string, string>,
    ): NoteHtml {
      const fragment = parse(html);
      visitReferences(fragment, ({ url, replace }) => {
        const next = replacements.get(url);
        if (next !== undefined) {
          replace(next);
        }
      });
      return NoteHtml.create(serialize(fragment));
    },

    inlineStylesheets(
      html: NoteHtml,
      contents: ReadonlyMap<string, string>,
      unavailable: ReadonlySet<string>,
    ): NoteHtml {
      const fragment = parse(html);
      walkElements(fragment.childNodes, (element) => {
        if (isSvg(element) || element.tagName !== "style") {
          return;
        }
        const attribute = element.attrs.find(
          (candidate) => attributeName(candidate) === STYLESHEET_HREF_ATTRIBUTE,
        );
        if (attribute === undefined) {
          return;
        }
        const url = attribute.value.trim();
        const css = contents.get(url);
        if (css !== undefined) {
          attribute.name = IMPORTED_STYLESHEET_ATTRIBUTE;
          // A `</style` inside the fetched CSS would close the element
          // during the next parse and let the remainder of the sheet be
          // read as markup.
          adopt(element, [textNode(css.replace(/<\/style/gi, ""), element)]);
          return;
        }
        if (unavailable.has(url)) {
          attribute.name = UNAVAILABLE_STYLESHEET_ATTRIBUTE;
          adopt(element, []);
        }
      });
      return NoteHtml.create(serialize(fragment));
    },

    editTextNodes(
      html: NoteHtml,
      edits: readonly TextNodeEdit[],
    ): EditTextNodesResult {
      const fragment = parse(html);
      const skipped: SkippedEdit[] = [];
      for (const edit of edits) {
        const target = resolveTextNode(fragment, edit.path);
        if (target === null) {
          skipped.push({ path: edit.path, reason: "pathNotFound" });
          continue;
        }
        if (target.value !== edit.expected) {
          skipped.push({ path: edit.path, reason: "contentChanged" });
          continue;
        }
        target.value = edit.text;
      }
      return { html: NoteHtml.create(serialize(fragment)), skipped };
    },
  };
}
