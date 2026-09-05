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
import type { UrlKind } from "../../domain/note/services/urlPolicy";
import {
  filterAllowedSrcset,
  formatSrcset,
  isAllowedUrl,
  parseSrcset,
  RESOURCE_SCHEMES,
  schemeOf,
} from "../../domain/note/services/urlPolicy";
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
  DROP_WITH_CONTENT,
  ELEMENT_ATTRIBUTES,
  GLOBAL_ATTRIBUTE_PREFIXES,
  GLOBAL_ATTRIBUTES,
  HEADING_ELEMENTS,
  IMPORTED_STYLESHEET_ATTRIBUTE,
  NAVIGATION_URL_ATTRIBUTES,
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
      const filtered = filterAllowedSrcset(attribute.value, ({ scheme }) => {
        report({
          kind: "url",
          name: scheme ?? "unknown",
          reason: `${lower} candidate uses a scheme outside the resource allow-list (spec/adr/013)`,
        });
      });
      if (filtered === null) {
        continue;
      }
      kept.push({ ...attribute, value: filtered });
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
    // Appended one at a time rather than spread as arguments: unwrapping
    // an unlisted element returns all of its children at once, and a
    // spread of them is an argument list, which has an engine limit that
    // raises a `RangeError` carrying no `kind`.
    for (const child of sanitizeNode(node, parent, report, insideSvg, budget)) {
      out.push(child);
    }
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
  // Where the search for a base left off. `taken` and `claimed` only
  // grow, so a suffix this base has already passed over stays rejected
  // and never has to be tried again — restarting the count at 2 for every
  // heading is what made a body of identical headings quadratic (16,000
  // of them took 7.4 seconds). The candidates a base yields, and the
  // order it yields them in, are unchanged.
  const resumeAt = new Map<string, number>();
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
      // 1 stands for the bare base, which carries no suffix.
      let suffix = resumeAt.get(base) ?? 1;
      let candidate = suffix === 1 ? base : `${base}-${suffix}`;
      while (taken.has(candidate) || claimed.has(candidate)) {
        suffix = suffix === 1 ? 2 : suffix + 1;
        candidate = `${base}-${suffix}`;
      }
      resumeAt.set(base, suffix + 1);
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

/**
 * Nodes `parseFragment` builds before it reads a byte of the source: the
 * `template` it takes as the fragment context, the mock document, and the
 * `html` root every top-level node is appended to. They are the parser's,
 * not the source's, so the node ceiling is granted them on top —
 * `HtmlProcessorLimit.maxNodes` is then exactly how many nodes the
 * source's own tree may hold, on either parse path.
 */
const PARSE_SCAFFOLD_NODES = 3;

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
 *
 * The same four points count *nodes*, which bytes do not bound: 200,000
 * `<br>`s are 800,000 bytes and expand 1.0×. What the count holds off is
 * everything downstream that is superlinear or capped in the number of
 * siblings rather than in bytes — the parser's own move of each top-level
 * node out of the parse root, the heading walk, and the argument count of
 * an unwrap. A text insertion is charged a node only when it makes one:
 * the parser hands over a run of characters at a time and the default
 * adapter folds consecutive runs into the text node already there, so
 * counting calls would count the tokenizer's chunking instead of the tree.
 */
const createMeteredTreeAdapter = (
  allowance: number,
  nodeAllowance: number,
): TreeAdapter<DefaultTreeAdapterMap> => {
  let remaining = allowance;
  let remainingNodes = nodeAllowance;
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
  const spendNode = (): void => {
    remainingNodes -= 1;
    if (remainingNodes < 0) {
      throw new BusinessRuleError(
        HTML_PROCESSOR_TOO_COMPLEX,
        `HTML holds more than ${HtmlProcessorLimit.maxNodes} nodes when parsed`,
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
      spendNode();
      return defaultTreeAdapter.createElement(tagName, namespaceURI, attrs);
    },
    createCommentNode(data) {
      spend(data.length + COMMENT_MARKUP_BYTES);
      spendNode();
      return defaultTreeAdapter.createCommentNode(data);
    },
    insertText(parentNode, text) {
      spend(text.length);
      const before = parentNode.childNodes.length;
      defaultTreeAdapter.insertText(parentNode, text);
      if (parentNode.childNodes.length !== before) {
        spendNode();
      }
    },
    insertTextBefore(parentNode, text, referenceNode) {
      spend(text.length);
      const before = parentNode.childNodes.length;
      defaultTreeAdapter.insertTextBefore(parentNode, text, referenceNode);
      if (parentNode.childNodes.length !== before) {
        spendNode();
      }
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

/**
 * The two constructs whose parse depends on whether a `<template>` is
 * open, and so the two that make the wrapped parse below differ from a
 * plain one.
 *
 * `</template>` closes the wrapper itself. `<form>` is the parser's one
 * piece of state that is scoped to the nearest open template: with none
 * open, a second `<form>` start tag is ignored and `</form>` unwinds the
 * stack differently. Neither survives sanitization (`form` is not on the
 * allow list, so it is unwrapped), but the *nesting* around them can
 * shift, so an input containing either takes the plain path rather than
 * a path that reasons about what the difference costs. Everything else
 * matches: fragments drawn from the whole tag vocabulary rather than the
 * allow list — sanitization runs *after* the parse, so an unlisted
 * element still moves the tree — parse identically both ways over 390,000
 * random sequences and an exhaustive 1,560,896 of length three across the
 * 57 tags whose parse can branch. Every fragment that differed matched
 * this pattern.
 *
 * The plain path is slower, not unbounded: the quadratic move it keeps is
 * in the number of top-level nodes, which `HtmlProcessorLimit.maxNodes`
 * caps. Comparing the two parses on every input instead would pay a
 * pathological input's cost twice to save it once.
 */
const TEMPLATE_SENSITIVE = /<\/template|<form/i;

/**
 * The fragment of `<template>${html}`, or `null` when the source closed
 * the wrapper itself.
 *
 * parse5 appends every top-level node to the root element of the parse
 * and then moves them into the fragment it returns one at a time, each
 * move an `indexOf` plus a `splice` over that root's child list — which
 * is quadratic in the number of top-level nodes. 130,000 flat elements
 * (1,950,000 bytes, inside the transport ceiling for a body, expanding
 * 1.0× and nesting three deep) spend 97% of the parse on that curve —
 * 1.4 seconds of a 1.5-second `process`. `HtmlProcessorLimit.maxNodes`
 * refuses an input that large outright; the wrapper is what keeps the
 * inputs *below* the node ceiling — the legitimate ones included — off
 * the same curve.
 *
 * An unterminated `<template>` in front of the source puts those nodes
 * in the template's content fragment instead, which the parser only ever
 * appends to, leaving the root with the single wrapper to move. It is
 * unterminated so that nothing is appended after the source: a `</…>`
 * would land inside the content of a raw-text element the source left
 * open (`<plaintext>`, an unclosed `<style>`), which is text the filter
 * would then be carrying that the source never had. The wrapper is also
 * the insertion mode a plain fragment parse already uses — parse5's
 * default context element is a `template` — so what it parses to is the
 * same tree, not a repaired variant of it.
 */
const parseWrapped = (
  html: string,
  allowance: number,
): DocumentFragment | null => {
  const root = parseFragment(`<template>${html}`, {
    // The wrapper is this module's, not the source's, so what the meter
    // charges for it — a node and its serialized length — is added back
    // rather than taken out of what the source is allowed to expand to.
    treeAdapter: createMeteredTreeAdapter(
      allowance + "template".length * 2 + ELEMENT_MARKUP_BYTES,
      HtmlProcessorLimit.maxNodes + PARSE_SCAFFOLD_NODES + 1,
    ),
  });
  const [wrapper] = root.childNodes;
  return root.childNodes.length === 1 &&
    wrapper !== undefined &&
    "content" in wrapper
    ? wrapper.content
    : null;
};

const parse = (html: string): DocumentFragment => {
  const allowance = expansionAllowance(html.length);
  const wrapped = TEMPLATE_SENSITIVE.test(html)
    ? null
    : parseWrapped(html, allowance);
  const fragment =
    wrapped ??
    parseFragment(html, {
      treeAdapter: createMeteredTreeAdapter(
        allowance,
        HtmlProcessorLimit.maxNodes + PARSE_SCAFFOLD_NODES,
      ),
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
 *
 * Every composition root wires this same adapter, so the parser under it
 * has to be plain JavaScript that runs unchanged on Node and on workerd:
 * no `node:` imports, no `process` / `Buffer`, nothing that needs the
 * `nodejs_compat` flag. parse5 meets that (its only dependency is
 * `entities`); a replacement that does not cannot be wired here.
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
      // One budget for the call, like `process`: a page with fifty traces
      // gets one scan allowance, not fifty.
      const budget = createCssBudget();
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
          // The sheet comes from a third-party origin and nothing
          // downstream sanitizes what this method returns, so the CSS
          // rules of ADR 013 apply here as they do in `process` —
          // `position: fixed` and `@import` are as dangerous inlined as
          // they are inline.
          const filtered = filterCss(css, () => {}, budget);
          // A `</style` inside the fetched CSS would close the element
          // during the next parse and let the remainder of the sheet be
          // read as markup. Escaped rather than removed, because a removal
          // splices what surrounded it back together and a sheet spelled
          // `</st</styleyle` re-forms the end tag the pass just took out.
          // `\/` is CSS's escape for `/`, so the sheet means the same, and
          // the escape is its own fixed point: it only ever inserts a `\`,
          // which is not a character of `</style`, so no `</style` can
          // survive or be formed by the substitution.
          const safe = filtered.replace(/<\/(?=style)/gi, "<\\/");
          adopt(element, safe.length === 0 ? [] : [textNode(safe, element)]);
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
