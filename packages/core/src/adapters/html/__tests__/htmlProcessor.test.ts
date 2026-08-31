import { describe, expect, it } from "vitest";
import { BusinessRuleError } from "../../../domain/error";
import type { RemovedNode } from "../../../domain/note/ports/htmlProcessor";
import { NoteHtml } from "../../../domain/note/valueObject";
import { createHtmlProcessor } from "../htmlProcessor";

const processor = createHtmlProcessor();

/**
 * `HtmlProcessor` is not a persistence port, so it has no conformance
 * suite to inherit ([ADR 026](../../../../../spec/adr/026-port-contract-and-conformance.md)
 * scopes those to repositories). The sanitize policy is still one closed
 * table, so the cases are held as data here: a second backend can run the
 * same table by swapping the factory above.
 */
type Removal = Readonly<{ kind: RemovedNode["kind"]; name: string }>;

type SanitizeCase = Readonly<{
  tc: string;
  title: string;
  input: string;
  /** Exact expected output, when the whole serialization is the claim. */
  html?: string;
  present?: readonly string[];
  absent?: readonly string[];
  removed?: readonly Removal[];
  noRemovals?: boolean;
  text?: string;
  hasDecoration?: boolean;
}>;

const DOCUMENT_HTML =
  "<h2>見出し</h2><p>本文の<strong>強調</strong></p>" +
  "<ul><li>一</li></ul><table><tbody><tr><td>表</td></tr></tbody></table>" +
  "<details><summary>概要</summary>中身</details>" +
  "<figure><figcaption>説明</figcaption></figure>" +
  "<ruby>漢<rp>(</rp><rt>かん</rt><rp>)</rp></ruby>";

const sanitizeCases: readonly SanitizeCase[] = [
  {
    tc: "TC-note-682",
    title: "keeps valid document HTML untouched and reports nothing",
    input: "<p>ふつうの<em>本文</em></p>",
    html: "<p>ふつうの<em>本文</em></p>",
    noRemovals: true,
    text: "ふつうの本文",
  },
  {
    tc: "TC-note-683",
    title: "removes script together with its source",
    input: "<p>hi<script>alert(1)</script></p>",
    html: "<p>hi</p>",
    removed: [{ kind: "element", name: "script" }],
  },
  {
    tc: "TC-note-684",
    title: "removes noscript with its content, so no parser resurrects it",
    input: "<p>a</p><noscript><img src=x onerror=alert(1)></noscript>",
    html: "<p>a</p>",
    absent: ["noscript", "onerror"],
    removed: [{ kind: "element", name: "noscript" }],
  },
  {
    tc: "TC-note-685",
    title: "removes an event handler attribute and keeps the element",
    input: '<p onclick="steal()">a</p>',
    html: "<p>a</p>",
    removed: [{ kind: "attribute", name: "onclick" }],
  },
  {
    tc: "TC-note-686",
    title: "removes a javascript: URL",
    input: '<a href="javascript:alert(1)">x</a>',
    html: "<a>x</a>",
    removed: [{ kind: "url", name: "javascript" }],
  },
  {
    tc: "TC-note-687",
    title: "removes vbscript: / file: / blob: URLs",
    input:
      '<a href="vbscript:x">a</a><img src="file:///etc/passwd"><img src="blob:https://a/b">',
    html: "<a>a</a><img><img>",
    removed: [
      { kind: "url", name: "vbscript" },
      { kind: "url", name: "file" },
      { kind: "url", name: "blob" },
    ],
  },
  {
    tc: "TC-note-688",
    title: "removes iframe; frame / frameset cannot reach the body at all",
    input: '<iframe src="https://evil">f</iframe><frameset><frame></frameset>',
    html: "",
    absent: ["iframe", "frameset", "<frame"],
    removed: [{ kind: "element", name: "iframe" }],
  },
  {
    tc: "TC-note-689",
    title:
      "removes iframe and reports srcdoc separately, leaving no HTML from the attribute value",
    input: '<iframe srcdoc="&lt;script&gt;alert(1)&lt;/script&gt;"></iframe>',
    html: "",
    absent: ["script", "srcdoc"],
    removed: [
      { kind: "element", name: "iframe" },
      { kind: "attribute", name: "srcdoc" },
    ],
  },
  {
    tc: "TC-note-690",
    title: "removes srcdoc from an allowed element too",
    input: '<div srcdoc="&lt;b&gt;x&lt;/b&gt;">keep</div>',
    html: "<div>keep</div>",
    removed: [{ kind: "attribute", name: "srcdoc" }],
  },
  {
    tc: "TC-note-691",
    title: "removes object / embed / applet",
    input:
      '<object data="x.swf"></object><embed src="y.swf"><applet code="z"></applet>',
    html: "",
    removed: [
      { kind: "element", name: "object" },
      { kind: "element", name: "embed" },
      { kind: "element", name: "applet" },
    ],
  },
  {
    tc: "TC-note-692",
    title: "removes the form controls that would let a phishing form exist",
    input:
      '<form action="https://evil"><input name="password"><select><option>o</option></select><textarea>t</textarea><button>send</button></form>',
    absent: ["<form", "<input", "<select", "<textarea", "<button"],
    removed: [
      { kind: "element", name: "form" },
      { kind: "element", name: "input" },
      { kind: "element", name: "select" },
      { kind: "element", name: "textarea" },
      { kind: "element", name: "button" },
    ],
  },
  {
    tc: "TC-note-693",
    title: "removes base, so no relative URL is redirected wholesale",
    input: '<base href="https://evil/"><a href="/x">x</a>',
    html: '<a href="/x">x</a>',
    removed: [{ kind: "element", name: "base" }],
  },
  {
    tc: "TC-note-694",
    title: "removes a meta refresh",
    input: '<meta http-equiv="refresh" content="0;url=https://evil">',
    html: "",
    removed: [{ kind: "element", name: "meta" }],
  },
  {
    tc: "TC-note-695",
    title: "removes link rel=stylesheet and reports it",
    input: '<link rel="stylesheet" href="https://cdn.example/x.css">',
    absent: ["<link"],
    removed: [{ kind: "element", name: "link" }],
  },
  {
    tc: "TC-note-696",
    title:
      "leaves an empty data-stylesheet-href trace at the position the link held",
    input:
      '<p>a</p><link rel="stylesheet" href="https://cdn.example/x.css"><p>b</p>',
    html: '<p>a</p><style data-stylesheet-href="https://cdn.example/x.css"></style><p>b</p>',
    hasDecoration: true,
  },
  {
    tc: "TC-note-698",
    title: "leaves an untouched data-stylesheet-href trace exactly as it is",
    input: '<style data-stylesheet-href="https://cdn.example/x.css"></style>',
    html: '<style data-stylesheet-href="https://cdn.example/x.css"></style>',
    noRemovals: true,
  },
  {
    tc: "TC-note-701",
    title: "keeps an imported stylesheet trace and its CSS",
    input:
      '<style data-imported-stylesheet="https://cdn.example/x.css">.a{color:red}</style>',
    present: [
      'data-imported-stylesheet="https://cdn.example/x.css"',
      "color:red",
    ],
    hasDecoration: true,
  },
  {
    tc: "TC-note-702",
    title: "keeps an unavailable stylesheet trace",
    input:
      '<style data-stylesheet-unavailable="https://cdn.example/x.css"></style>',
    html: '<style data-stylesheet-unavailable="https://cdn.example/x.css"></style>',
    noRemovals: true,
  },
  {
    tc: "TC-note-703",
    title: "removes template, whose content the later walks would not see",
    input: "<template><b>x</b></template>",
    html: "",
    removed: [{ kind: "element", name: "template" }],
  },
  {
    tc: "TC-note-704",
    title: "removes an unlisted element and an unlisted attribute",
    // The unlisted wrapper goes and its prose stays: dropping the subtree
    // of every unknown element would delete body text on import.
    input: '<marquee behavior="scroll">move</marquee><p ping="/t">a</p>',
    html: "move<p>a</p>",
    absent: ["marquee", "behavior", "ping"],
    removed: [
      { kind: "element", name: "marquee" },
      { kind: "attribute", name: "ping" },
    ],
  },
  {
    tc: "TC-note-705",
    title: "drops only the position: fixed declaration inside a style element",
    input: "<style>.a{position:fixed;color:red}.b{color:blue}</style>",
    present: ["<style>", "color:red", "color:blue"],
    absent: ["fixed"],
    removed: [{ kind: "css", name: "position" }],
  },
  {
    tc: "TC-note-706",
    title: "drops the @import rule and keeps the rest of the sheet",
    input: "<style>@import url(evil.css); .a{color:red}</style>",
    present: ["color:red"],
    absent: ["@import"],
    removed: [{ kind: "css", name: "@import" }],
  },
  {
    tc: "TC-note-707",
    title: "drops only position: fixed inside a style attribute",
    input: '<p style="position:fixed;color:red">x</p>',
    html: '<p style="color:red;">x</p>',
    removed: [{ kind: "css", name: "position" }],
  },
  {
    tc: "TC-note-708",
    title: "drops sticky, its vendor-prefixed value, and !important forms",
    input:
      '<p style="position:sticky">a</p><p style="position:-webkit-sticky">b</p><p style="position:sticky !important">c</p>',
    html: "<p>a</p><p>b</p><p>c</p>",
    removed: [{ kind: "css", name: "position" }],
  },
  {
    tc: "TC-note-709",
    title: "keeps position: absolute",
    input: '<p style="position:absolute;color:red">x</p>',
    present: ["position:absolute"],
    noRemovals: true,
  },
  // The browser resolves comments and identifier escapes before it reads a
  // property name, so every spelling below is effectively the plain one that
  // TC-note-705 / 706 / 707 cover.
  {
    tc: "TC-note-705 / B-001",
    title: "drops position: fixed written with a comment inside the value",
    input: '<p style="position:/**/fixed">x</p>',
    html: "<p>x</p>",
    removed: [{ kind: "css", name: "position" }],
  },
  {
    tc: "TC-note-705 / B-001",
    title: "drops position: fixed written with a comment before the colon",
    input: '<p style="position/**/:fixed">x</p>',
    html: "<p>x</p>",
    removed: [{ kind: "css", name: "position" }],
  },
  {
    tc: "TC-note-705 / B-001",
    title: "drops position: fixed written with a comment hiding a colon",
    input: '<p style="/*:*/position:fixed">x</p>',
    html: "<p>x</p>",
    removed: [{ kind: "css", name: "position" }],
  },
  {
    tc: "TC-note-705 / B-001",
    title: "drops a commented position: fixed inside a style element",
    input: "<style>.a{position:/**/fixed;color:red}</style>",
    present: ["color:red"],
    absent: ["fixed"],
    removed: [{ kind: "css", name: "position" }],
  },
  {
    tc: "TC-note-705 / B-001",
    title: "drops position: fixed written with an identifier escape",
    input: '<p style="position:\\66 ixed">x</p>',
    html: "<p>x</p>",
    removed: [{ kind: "css", name: "position" }],
  },
  {
    tc: "TC-note-708 / B-001",
    title: "drops position: sticky whose !important is written escaped",
    input: '<p style="position:sticky!\\69 mportant">x</p>',
    html: "<p>x</p>",
    removed: [{ kind: "css", name: "position" }],
  },
  {
    tc: "TC-note-706 / B-001",
    title: "drops @import written with an identifier escape",
    input: "<style>@\\69 mport url(evil.css); .a{color:red}</style>",
    present: ["color:red"],
    absent: ["mport"],
    removed: [{ kind: "css", name: "@import" }],
  },
  {
    tc: "TC-note-706 / B-001",
    title: "drops @import written with a comment before its prelude",
    input: "<style>@import/**/url(evil.css); .a{color:red}</style>",
    present: ["color:red"],
    absent: ["evil.css"],
    removed: [{ kind: "css", name: "@import" }],
  },
  {
    tc: "TC-note-709 / B-001",
    title: "keeps a property a comment splits, which no browser resolves",
    // A comment separates identifiers rather than joining them, so this is
    // an unknown property and not `position` — over-removing here would eat
    // decoration the preserve mode exists to keep.
    input: '<p style="pos/**/ition:fixed">x</p>',
    present: ["pos/**/ition:fixed"],
    noRemovals: true,
  },
  {
    tc: "TC-note-710",
    title: "keeps a style element and a style attribute with no banned rule",
    input: '<style>.a{color:red}</style><p style="color:blue">x</p>',
    present: ["<style>", "color:red", 'style="color:blue;"'],
    noRemovals: true,
    hasDecoration: true,
  },
  {
    tc: "TC-note-711",
    title: "keeps a data:image/png resource reference",
    input: '<img src="data:image/png;base64,AAAA">',
    html: '<img src="data:image/png;base64,AAAA">',
    noRemovals: true,
  },
  {
    tc: "TC-note-712",
    title: "removes data:text/html and data:image/svg+xml, which carry script",
    input:
      '<img src="data:text/html,%3Cscript%3E"><img src="data:image/svg+xml,%3Csvg%3E">',
    html: "<img><img>",
    removed: [{ kind: "url", name: "data" }],
  },
  {
    tc: "TC-note-713",
    title: "removes a data: URL used as a navigation target",
    input: '<a href="data:image/png;base64,AAAA">x</a>',
    html: "<a>x</a>",
    removed: [{ kind: "url", name: "data" }],
  },
  {
    tc: "TC-note-714",
    title: "keeps the document elements of the allow-list and reports nothing",
    input: DOCUMENT_HTML,
    noRemovals: true,
    present: [
      "<h2",
      "<strong>",
      "<li>",
      "<td>",
      "<summary>",
      "<figcaption>",
      "<rt>",
    ],
  },
  {
    tc: "TC-note-715",
    title: "keeps class / id / data-* / aria-*",
    input: '<p class="c" id="i" data-k="v" aria-label="l">x</p>',
    html: '<p class="c" id="i" data-k="v" aria-label="l">x</p>',
    noRemovals: true,
  },
  {
    tc: "TC-note-716",
    title: "removes autofocus, a global attribute that carries behaviour",
    input: "<p autofocus>x</p>",
    html: "<p>x</p>",
    removed: [{ kind: "attribute", name: "autofocus" }],
  },
  {
    tc: "TC-note-717",
    title: "normalizes target=_blank to carry noopener noreferrer",
    input: '<a href="https://x.example" target="_blank" rel="nofollow">x</a>',
    html: '<a href="https://x.example" target="_blank" rel="nofollow noopener noreferrer">x</a>',
  },
  {
    tc: "TC-note-718",
    title:
      "keeps only the svg drawing subset and refuses references leaving the document",
    input:
      '<svg viewBox="0 0 1 1"><path d="M0 0" fill="red"/><script>alert(1)</script><foreignObject><b>x</b></foreignObject><use href="https://evil#a"/><use href="#local"/></svg>',
    html: '<svg viewBox="0 0 1 1"><path d="M0 0" fill="red"></path><use></use><use href="#local"></use></svg>',
    removed: [
      { kind: "element", name: "script" },
      { kind: "element", name: "foreignObject" },
      { kind: "url", name: "https" },
    ],
  },
  {
    tc: "TC-note-719",
    title: "reports element, attribute, url and css removals side by side",
    input:
      '<applet code="z"></applet><p onclick="x()" style="position:fixed"><a href="javascript:x">l</a></p>',
    removed: [
      { kind: "element", name: "applet" },
      { kind: "attribute", name: "onclick" },
      { kind: "url", name: "javascript" },
      { kind: "css", name: "position" },
    ],
  },
  {
    tc: "TC-note-720",
    title: "repairs broken HTML instead of rejecting it",
    input: "<div><p>unclosed<b>bold</div>",
    html: "<div><p>unclosed<b>bold</b></p></div>",
  },
];

describe("HtmlProcessor.process — ADP-note-001 sanitize allow-list (spec/adr/013)", () => {
  it.each(sanitizeCases)("$tc: $title", (testCase) => {
    const result = processor.process(testCase.input);

    if (testCase.html !== undefined) {
      expect(result.html).toBe(testCase.html);
    }
    for (const fragment of testCase.present ?? []) {
      expect(result.html).toContain(fragment);
    }
    for (const fragment of testCase.absent ?? []) {
      expect(result.html).not.toContain(fragment);
    }
    if (testCase.noRemovals === true) {
      expect(result.removed).toEqual([]);
    }
    for (const removal of testCase.removed ?? []) {
      expect(
        result.removed.map(({ kind, name }) => ({ kind, name })),
      ).toContainEqual(removal);
    }
    if (testCase.text !== undefined) {
      expect(result.text).toBe(testCase.text);
    }
    if (testCase.hasDecoration !== undefined) {
      expect(result.hasDecoration).toBe(testCase.hasDecoration);
    }
  });
});

describe("HtmlProcessor.process — ADP-note-001 derived projections", () => {
  it("TC-note-721: refuses a body that exceeds 800,000 bytes after sanitization", () => {
    expect(() => processor.process("a".repeat(800_001))).toThrow(
      BusinessRuleError,
    );
  });

  it("TC-note-722: accepts a body of exactly 800,000 bytes", () => {
    expect(processor.process("a".repeat(800_000)).html).toHaveLength(800_000);
  });

  it("indexes every heading with an id that resolves in the returned html", () => {
    const result = processor.process(
      "<h1>One</h1><h2>Two</h2><h2>Two</h2><h3 id='kept'>Three</h3>",
    );
    expect(result.headings).toEqual([
      { level: 1, text: "One", anchorId: "one" },
      { level: 2, text: "Two", anchorId: "two" },
      { level: 2, text: "Two", anchorId: "two-2" },
      { level: 3, text: "Three", anchorId: "kept" },
    ]);
    for (const heading of result.headings) {
      expect(result.html).toContain(`id="${heading.anchorId}"`);
    }
  });

  it("derives text and excerpt from the sanitized body, with style source left out", () => {
    const result = processor.process(
      `<style>.a{content:"css"}</style><p>${"あ".repeat(250)}</p><p>次</p>`,
    );
    expect(result.text).toBe(`${"あ".repeat(250)} 次`);
    expect(result.excerpt).toBe("あ".repeat(200));
  });

  it("counts a removed link rel=stylesheet as decoration (spec/adr/007)", () => {
    expect(
      processor.process('<link rel="stylesheet" href="https://cdn/x.css">')
        .hasDecoration,
    ).toBe(true);
    expect(processor.process("<p>plain</p>").hasDecoration).toBe(false);
  });
});

describe("HtmlProcessor.extractExternalReferences — ADP-note-002", () => {
  const body = processor.process(
    '<img src="https://cdn.example/a.png" srcset="https://cdn.example/b.png 2x">' +
      '<video poster="/storage/p.jpg" src="https://cdn.example/v.mp4"></video>' +
      '<a href="https://page.example/doc">l</a>' +
      '<link rel="stylesheet" href="https://cdn.example/s.css">',
  ).html;

  it("TC-note-697: reports the data-stylesheet-href trace as an ordinary reference", () => {
    expect(processor.extractExternalReferences(body)).toContainEqual({
      url: "https://cdn.example/s.css",
      attribute: "data-stylesheet-href",
      elementName: "style",
    });
  });

  it("reports every resource attribute, internal URLs included", () => {
    expect(processor.extractExternalReferences(body)).toEqual([
      {
        url: "https://cdn.example/a.png",
        attribute: "src",
        elementName: "img",
      },
      {
        url: "https://cdn.example/b.png",
        attribute: "srcset",
        elementName: "img",
      },
      { url: "/storage/p.jpg", attribute: "poster", elementName: "video" },
      {
        url: "https://cdn.example/v.mp4",
        attribute: "src",
        elementName: "video",
      },
      {
        url: "https://cdn.example/s.css",
        attribute: "data-stylesheet-href",
        elementName: "style",
      },
    ]);
  });

  it("TC-note-701 / TC-note-702: settled stylesheet traces are not extraction-eligible", () => {
    const settled = processor.process(
      '<style data-imported-stylesheet="https://cdn.example/x.css">.a{color:red}</style>' +
        '<style data-stylesheet-unavailable="https://cdn.example/y.css"></style>',
    ).html;
    expect(processor.extractExternalReferences(settled)).toEqual([]);
  });

  it("leaves navigation targets and fragments out, so no hyperlink is imported", () => {
    const urls = processor
      .extractExternalReferences(body)
      .map((reference) => reference.url);
    expect(urls).not.toContain("https://page.example/doc");
  });
});

describe("HtmlProcessor.rewriteReferences — ADP-note-003", () => {
  const body = processor.process(
    '<img src="https://cdn.example/a.png" srcset="https://cdn.example/b.png 2x, https://cdn.example/c.png 3x">' +
      '<a href="https://cdn.example/a.png">l</a>',
  ).html;

  it("replaces a mapped URL in src and inside one srcset candidate", () => {
    expect(
      processor.rewriteReferences(
        body,
        new Map([
          ["https://cdn.example/a.png", "/storage/a.png"],
          ["https://cdn.example/b.png", "/storage/b.png"],
        ]),
      ),
    ).toBe(
      '<img src="/storage/a.png" srcset="/storage/b.png 2x, https://cdn.example/c.png 3x">' +
        '<a href="https://cdn.example/a.png">l</a>',
    );
  });

  it("leaves the body byte-identical when nothing maps", () => {
    expect(processor.rewriteReferences(body, new Map())).toBe(body);
  });
});

describe("HtmlProcessor.inlineStylesheets — ADP-note-004 (spec/adr/014)", () => {
  const body = processor.process(
    '<p>a</p><link rel="stylesheet" href="https://cdn.example/x.css">',
  ).html;

  it("moves a fetched trace to data-imported-stylesheet with the CSS inside", () => {
    expect(
      processor.inlineStylesheets(
        body,
        new Map([["https://cdn.example/x.css", ".a{color:red}"]]),
        new Set(),
      ),
    ).toBe(
      '<p>a</p><style data-imported-stylesheet="https://cdn.example/x.css">.a{color:red}</style>',
    );
  });

  it("moves an unavailable trace to data-stylesheet-unavailable and keeps it empty", () => {
    expect(
      processor.inlineStylesheets(
        body,
        new Map(),
        new Set(["https://cdn.example/x.css"]),
      ),
    ).toBe(
      '<p>a</p><style data-stylesheet-unavailable="https://cdn.example/x.css"></style>',
    );
  });

  it("leaves a trace named by neither map alone, so the next save can retry it", () => {
    expect(processor.inlineStylesheets(body, new Map(), new Set())).toBe(body);
  });

  it("neutralizes a </style> inside fetched CSS instead of letting it close the element", () => {
    const inlined = processor.inlineStylesheets(
      body,
      new Map([
        ["https://cdn.example/x.css", "a{}</style><script>alert(1)</script>"],
      ]),
      new Set(),
    );
    expect(inlined).not.toContain("</style><script");
    // Re-parsing is where a breakout would surface: the script would be a
    // real element, and sanitization would have to report removing one.
    expect(
      processor
        .process(inlined)
        .removed.filter(({ kind }) => kind === "element"),
    ).toEqual([]);
  });
});

describe("HtmlProcessor.editTextNodes — ADP-note-005", () => {
  const body = processor.process(
    '<p class="c" style="color:red">a<b>bold</b>c</p><style>.x{color:red}</style>',
  ).html;

  it("TC-note-001: applies an edit whose path and expected text both match", () => {
    const result = processor.editTextNodes(body, [
      { path: "0.0", expected: "a", text: "A" },
    ]);
    expect(result.skipped).toEqual([]);
    expect(result.html).toContain(
      '<p class="c" style="color:red;">A<b>bold</b>c</p>',
    );
  });

  it("TC-note-002: leaves class and style attributes in place", () => {
    const result = processor.editTextNodes(body, [
      { path: "0.1.0", expected: "bold", text: "BOLD" },
    ]);
    expect(result.html).toBe(
      '<p class="c" style="color:red;">a<b>BOLD</b>c</p><style>.x{color:red;}</style>',
    );
  });

  it("TC-note-003: skips an unresolvable path and applies the rest", () => {
    const result = processor.editTextNodes(body, [
      { path: "9.0", expected: "a", text: "A" },
      { path: "0.2", expected: "c", text: "C" },
    ]);
    expect(result.skipped).toEqual([{ path: "9.0", reason: "pathNotFound" }]);
    expect(result.html).toContain("<b>bold</b>C");
  });

  it("TC-note-004: skips an edit whose expected text no longer matches", () => {
    const result = processor.editTextNodes(body, [
      { path: "0.0", expected: "stale", text: "A" },
    ]);
    expect(result.skipped).toEqual([{ path: "0.0", reason: "contentChanged" }]);
    expect(result.html).toBe(body);
  });

  it("TC-note-005: returns the body unchanged when every edit is skipped", () => {
    const result = processor.editTextNodes(body, [
      { path: "9.9", expected: "a", text: "A" },
      { path: "0.0", expected: "stale", text: "A" },
    ]);
    expect(result.skipped).toHaveLength(2);
    expect(result.html).toBe(body);
  });

  it("TC-note-006: empties a node without deleting it", () => {
    const result = processor.editTextNodes(body, [
      { path: "0.0", expected: "a", text: "" },
    ]);
    expect(result.skipped).toEqual([]);
    expect(result.html).toContain(
      '<p class="c" style="color:red;"><b>bold</b>c</p>',
    );
  });

  it("TC-note-011: assigns no path inside script, so such an edit cannot land", () => {
    // `process` never emits `<script>`; the guard exists for a body that
    // reached storage through some other producer.
    const withScript = NoteHtml.create("<p>a</p><script>var x = 1;</script>");
    expect(
      processor.editTextNodes(withScript, [
        { path: "1.0", expected: "var x = 1;", text: "steal()" },
      ]),
    ).toEqual({
      html: withScript,
      skipped: [{ path: "1.0", reason: "pathNotFound" }],
    });
  });

  it("TC-note-012: assigns no path inside style, closing the CSS re-injection route", () => {
    const result = processor.editTextNodes(body, [
      {
        path: "1.0",
        expected: ".x{color:red;}",
        text: "body{position:fixed;top:0}",
      },
    ]);
    expect(result.skipped).toEqual([{ path: "1.0", reason: "pathNotFound" }]);
    expect(result.html).toBe(body);
  });

  it("skips a path that resolves to an element rather than a text node", () => {
    expect(
      processor.editTextNodes(body, [
        { path: "0", expected: "abold c", text: "x" },
      ]).skipped,
    ).toEqual([{ path: "0", reason: "pathNotFound" }]);
  });
});
