/**
 * Executable form of the sanitize allow-list of spec/adr/013.
 *
 * The ADR's tables are the canon; this module is a transcription of them
 * and nothing else. Every set here is closed — anything absent is
 * removed, which is the definition of the allow-list method. Adding an
 * element / attribute means changing the ADR first.
 */

const set = (...names: readonly string[]): ReadonlySet<string> =>
  new Set(names);

/** ADR 013 「許可する要素」. `svg` is the entry point into `ALLOWED_SVG_ELEMENTS`. */
export const ALLOWED_ELEMENTS: ReadonlySet<string> = set(
  // 文書構造
  "div",
  "p",
  "br",
  "hr",
  "span",
  "section",
  "article",
  "aside",
  "header",
  "footer",
  "nav",
  "main",
  "figure",
  "figcaption",
  "details",
  "summary",
  // 見出し
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  // リスト
  "ul",
  "ol",
  "li",
  "dl",
  "dt",
  "dd",
  // 表
  "table",
  "caption",
  "colgroup",
  "col",
  "thead",
  "tbody",
  "tfoot",
  "tr",
  "th",
  "td",
  // コード・整形済み
  "pre",
  "code",
  "kbd",
  "samp",
  "var",
  // 引用
  "blockquote",
  "q",
  "cite",
  // 強調・書式
  "strong",
  "em",
  "b",
  "i",
  "u",
  "s",
  "del",
  "ins",
  "mark",
  "small",
  "sub",
  "sup",
  "abbr",
  "time",
  "wbr",
  "bdi",
  "bdo",
  // ルビ
  "ruby",
  "rb",
  "rt",
  "rtc",
  "rp",
  // リンク
  "a",
  // メディア
  "img",
  "picture",
  "source",
  "video",
  "audio",
  "track",
  // スタイル
  "style",
  // 図版
  "svg",
);

/**
 * Elements removed together with their subtree rather than unwrapped.
 *
 * Everything else outside `ALLOWED_ELEMENTS` is unwrapped — the element
 * goes, its children stay — because an unlisted wrapper (`center`,
 * `font`, a web component) still wraps readable prose, and dropping it
 * whole would silently delete body text on import, which is the one
 * thing spec/adr/006 asks the import path to preserve.
 *
 * The elements listed here hold something that is *not* body prose:
 * script / markup source (`script`, `noscript`, `template`), an embedded
 * document (`iframe`, `frame`, `frameset`, `object`, `embed`, `applet`),
 * document metadata (`head`, `title`), or control-only content whose
 * text is a UI label rather than prose (`textarea`, `select`,
 * `optgroup`, `option`). Unwrapping those would promote their contents
 * into the body as text, which is exactly the `noscript` resurrection
 * path ADR 013 names.
 */
export const DROP_WITH_CONTENT: ReadonlySet<string> = set(
  "script",
  "noscript",
  "template",
  "head",
  "title",
  "textarea",
  "select",
  "optgroup",
  "option",
  "iframe",
  "frame",
  "frameset",
  "object",
  "embed",
  "applet",
  "math",
);

/** ADR 013 「許可する属性」の全要素行. `aria-*` / `data-*` are prefix rules. */
export const GLOBAL_ATTRIBUTES: ReadonlySet<string> = set(
  "class",
  "id",
  "title",
  "lang",
  "dir",
  "role",
  "style",
);

export const GLOBAL_ATTRIBUTE_PREFIXES: readonly string[] = ["aria-", "data-"];

/** ADR 013 「許可する属性」の要素別行. */
export const ELEMENT_ATTRIBUTES: ReadonlyMap<
  string,
  ReadonlySet<string>
> = new Map<string, ReadonlySet<string>>([
  ["a", set("href", "target", "rel", "download", "hreflang", "type")],
  [
    "img",
    set(
      "src",
      "srcset",
      "sizes",
      "alt",
      "width",
      "height",
      "loading",
      "decoding",
      "referrerpolicy",
    ),
  ],
  ["source", set("src", "srcset", "sizes", "type", "media", "width", "height")],
  [
    "video",
    set(
      "src",
      "controls",
      "poster",
      "preload",
      "loop",
      "muted",
      "playsinline",
      "width",
      "height",
    ),
  ],
  [
    "audio",
    set(
      "src",
      "controls",
      "poster",
      "preload",
      "loop",
      "muted",
      "playsinline",
      "width",
      "height",
    ),
  ],
  ["track", set("src", "kind", "srclang", "label", "default")],
  ["th", set("colspan", "rowspan", "headers", "scope", "abbr")],
  ["td", set("colspan", "rowspan", "headers", "scope", "abbr")],
  ["col", set("span")],
  ["colgroup", set("span")],
  ["ol", set("start", "reversed", "type")],
  ["li", set("value", "type")],
  ["blockquote", set("cite")],
  ["q", set("cite")],
  ["del", set("cite", "datetime")],
  ["ins", set("cite", "datetime")],
  ["time", set("datetime")],
  ["details", set("open")],
]);

/**
 * Attributes whose value is a navigation target: only the navigation
 * scheme row of ADR 013 applies, so `data:` is refused here even though
 * a resource reference may carry it.
 */
export const NAVIGATION_URL_ATTRIBUTES: ReadonlySet<string> = set(
  "href",
  "cite",
);

/** Attributes whose value is a single resource URL. */
export const RESOURCE_URL_ATTRIBUTES: ReadonlySet<string> = set(
  "src",
  "poster",
);

/** Attributes whose value is a comma-separated list of resource candidates. */
export const SRCSET_ATTRIBUTES: ReadonlySet<string> = set("srcset");

export const NAVIGATION_SCHEMES: ReadonlySet<string> = set(
  "https",
  "http",
  "mailto",
  "tel",
);

export const RESOURCE_SCHEMES: ReadonlySet<string> = set("https", "http");

/**
 * `data:` MIME types allowed in a resource reference. Deliberately raster
 * only: `text/html` and `image/svg+xml` can carry script (ADR 013).
 */
export const DATA_URL_MIME_TYPES: ReadonlySet<string> = set(
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
);

/**
 * The SVG drawing subset of ADR 013: shapes, paths, text, gradients and
 * same-document `use`. `script`, `foreignObject`, the animation elements
 * and `image` (an external fetch that no policy sees) are absent, so they
 * are removed like any other unlisted element.
 *
 * Names are spelled as the HTML parser adjusts them, which is the
 * camel-cased SVG form (`linearGradient`, `clipPath`, `textPath`).
 */
export const ALLOWED_SVG_ELEMENTS: ReadonlySet<string> = set(
  "svg",
  "g",
  "defs",
  "desc",
  "title",
  "symbol",
  "use",
  "marker",
  "path",
  "rect",
  "circle",
  "ellipse",
  "line",
  "polyline",
  "polygon",
  "text",
  "tspan",
  "textPath",
  "linearGradient",
  "radialGradient",
  "stop",
  "pattern",
  "clipPath",
  "mask",
);

/**
 * Geometry and presentation attributes of the SVG subset. Presentation
 * attributes are the CSS properties SVG also accepts as attributes; they
 * are listed rather than pattern-matched so the set stays closed like
 * every other row of ADR 013.
 *
 * `xmlns` / `xmlns:*` are deliberately absent: ADR 013 lists no namespace
 * declaration, and an inline `<svg>` takes the SVG namespace from the HTML
 * parser, so the declaration is dead weight in a body fragment. A
 * standalone `.svg` does need them, and `storeMedia.asStandaloneSvg` puts
 * them back on the document it builds out of this output.
 */
export const ALLOWED_SVG_ATTRIBUTES: ReadonlySet<string> = set(
  // 構造・座標系
  "viewBox",
  "preserveAspectRatio",
  "width",
  "height",
  "x",
  "y",
  "dx",
  "dy",
  "transform",
  "gradientTransform",
  "gradientUnits",
  "patternUnits",
  "patternContentUnits",
  "clipPathUnits",
  "maskUnits",
  "maskContentUnits",
  "markerUnits",
  "markerWidth",
  "markerHeight",
  "refX",
  "refY",
  "orient",
  "overflow",
  // 図形
  "d",
  "pathLength",
  "points",
  "cx",
  "cy",
  "r",
  "rx",
  "ry",
  "x1",
  "y1",
  "x2",
  "y2",
  "fx",
  "fy",
  "offset",
  "spreadMethod",
  // 塗り・線
  "fill",
  "fill-opacity",
  "fill-rule",
  "stroke",
  "stroke-width",
  "stroke-opacity",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-miterlimit",
  "stroke-dasharray",
  "stroke-dashoffset",
  "opacity",
  "color",
  "stop-color",
  "stop-opacity",
  "clip-path",
  "clip-rule",
  "mask",
  "paint-order",
  "shape-rendering",
  "vector-effect",
  // テキスト
  "font-family",
  "font-size",
  "font-style",
  "font-weight",
  "letter-spacing",
  "word-spacing",
  "text-anchor",
  "text-decoration",
  "dominant-baseline",
  "alignment-baseline",
  "baseline-shift",
  "writing-mode",
  "startOffset",
  "textLength",
  "lengthAdjust",
  "xml:space",
);

/**
 * Elements whose boundaries separate words in the extracted plain text.
 * Without them `<p>a</p><p>b</p>` would read as `ab`, and the excerpt /
 * search projection would join two unrelated sentences.
 */
export const BLOCK_LEVEL_ELEMENTS: ReadonlySet<string> = set(
  "address",
  "article",
  "aside",
  "blockquote",
  "br",
  "caption",
  "dd",
  "details",
  "div",
  "dl",
  "dt",
  "figcaption",
  "figure",
  "footer",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "hr",
  "li",
  "main",
  "nav",
  "ol",
  "p",
  "pre",
  "section",
  "summary",
  "table",
  "tbody",
  "td",
  "tfoot",
  "th",
  "thead",
  "tr",
  "ul",
);

export const HEADING_ELEMENTS: ReadonlySet<string> = set(
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
);

/** ADR 014 の痕跡 3 状態。抽出対象は `data-stylesheet-href` のみ。 */
export const STYLESHEET_HREF_ATTRIBUTE = "data-stylesheet-href";
export const IMPORTED_STYLESHEET_ATTRIBUTE = "data-imported-stylesheet";
export const UNAVAILABLE_STYLESHEET_ATTRIBUTE = "data-stylesheet-unavailable";
