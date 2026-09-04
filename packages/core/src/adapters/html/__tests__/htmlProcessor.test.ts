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
  /** Ledger row this case holds, when one covers it. */
  tc?: string;
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
    html: '<p style="color:red">x</p>',
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
    tc: "TC-note-705",
    title: "drops position: fixed written with a comment inside the value",
    input: '<p style="position:/**/fixed">x</p>',
    html: "<p>x</p>",
    removed: [{ kind: "css", name: "position" }],
  },
  {
    tc: "TC-note-705",
    title: "drops position: fixed written with a comment before the colon",
    input: '<p style="position/**/:fixed">x</p>',
    html: "<p>x</p>",
    removed: [{ kind: "css", name: "position" }],
  },
  {
    tc: "TC-note-705",
    title: "drops position: fixed written with a comment hiding a colon",
    input: '<p style="/*:*/position:fixed">x</p>',
    html: "<p>x</p>",
    removed: [{ kind: "css", name: "position" }],
  },
  {
    tc: "TC-note-705",
    title: "drops a commented position: fixed inside a style element",
    input: "<style>.a{position:/**/fixed;color:red}</style>",
    present: ["color:red"],
    absent: ["fixed"],
    removed: [{ kind: "css", name: "position" }],
  },
  {
    tc: "TC-note-705",
    title: "drops position: fixed written with an identifier escape",
    input: '<p style="position:\\66 ixed">x</p>',
    html: "<p>x</p>",
    removed: [{ kind: "css", name: "position" }],
  },
  {
    tc: "TC-note-708",
    title: "drops position: sticky whose !important is written escaped",
    input: '<p style="position:sticky!\\69 mportant">x</p>',
    html: "<p>x</p>",
    removed: [{ kind: "css", name: "position" }],
  },
  {
    tc: "TC-note-706",
    title: "drops @import written with an identifier escape",
    input: "<style>@\\69 mport url(evil.css); .a{color:red}</style>",
    present: ["color:red"],
    absent: ["mport"],
    removed: [{ kind: "css", name: "@import" }],
  },
  {
    tc: "TC-note-706",
    title: "drops @import written with a comment before its prelude",
    input: "<style>@import/**/url(evil.css); .a{color:red}</style>",
    present: ["color:red"],
    absent: ["evil.css"],
    removed: [{ kind: "css", name: "@import" }],
  },
  // An escape swallows what follows the `\`, so a quote or a paren written
  // escaped is an identifier character to the browser and never opens a
  // string or a group. A scan that missed this found no terminator, read
  // the whole run as one declaration, and judged it by its first property.
  {
    tc: "TC-note-705",
    title: "drops position after an escaped double quote in a style attribute",
    input: '<p style="content:\\&quot;;position:fixed">x</p>',
    present: ["content:\\&quot;;"],
    absent: ["fixed"],
    removed: [{ kind: "css", name: "position" }],
  },
  {
    tc: "TC-note-705",
    title: "drops position after an escaped single quote in a style attribute",
    input: '<p style="content:\\\';position:fixed">x</p>',
    present: ["content:\\';"],
    absent: ["fixed"],
    removed: [{ kind: "css", name: "position" }],
  },
  {
    tc: "TC-note-705",
    title: "drops position after an escaped quote inside a style element",
    input: '<style>.a{content:\\";position:fixed}</style>',
    present: ['content:\\";'],
    absent: ["fixed"],
    removed: [{ kind: "css", name: "position" }],
  },
  {
    tc: "TC-note-705",
    title: "drops position after an escaped opening paren in a style attribute",
    input: '<p style="background:url\\(x;position:fixed">x</p>',
    present: ["background:url\\(x;"],
    absent: ["fixed"],
    removed: [{ kind: "css", name: "position" }],
  },
  {
    tc: "TC-note-708",
    title: "drops sticky after an escaped opening paren inside a style element",
    input: "<style>.a{background:url\\(x;position:sticky}</style>",
    present: ["background:url\\(x;"],
    absent: ["sticky"],
    removed: [{ kind: "css", name: "position" }],
  },
  {
    tc: "TC-note-706",
    title:
      "drops only the @import an escaped paren follows, keeping the rule after it",
    // The same blind spot read backwards: an escaped `(` that opens a group
    // for the scanner but not for the browser swallows the decoration that
    // follows the at-rule instead of letting a declaration through.
    input: "<style>@import url\\(a;.b{position:fixed}</style>",
    present: [".b{"],
    absent: ["@import", "fixed"],
    removed: [
      { kind: "css", name: "@import" },
      { kind: "css", name: "position" },
    ],
  },
  // Inside an unquoted `url(` the browser is not tokenising any more: it
  // reads code points to the `)`, so comment and string notation written
  // there is part of the URL and the `;` after the `)` still ends the
  // declaration. A scan that took the `/*` for a comment lost that `;` and
  // read the overlay as part of one `background` declaration.
  {
    tc: "TC-note-707",
    title: "drops position after an unclosed comment opened inside url()",
    input: '<p style="background:url(x/*);position:fixed">x</p>',
    html: '<p style="background:url(x/*);">x</p>',
    removed: [{ kind: "css", name: "position" }],
  },
  {
    tc: "TC-note-705",
    title:
      "drops position after an unclosed comment opened inside url() in a style element",
    input: "<style>.a{background:url(x/*);position:fixed}</style>",
    present: ["background:url(x/*);"],
    absent: ["fixed"],
    removed: [{ kind: "css", name: "position" }],
  },
  {
    tc: "TC-note-707",
    title: "drops position after a comment closed only outside url()",
    input: '<p style="background:url(/*)*/;position:fixed">x</p>',
    html: '<p style="background:url(/*)*/;">x</p>',
    removed: [{ kind: "css", name: "position" }],
  },
  {
    tc: "TC-note-705",
    title:
      "drops position between a url() comment and the declaration after it",
    input: "<style>.a{background:url(/*)*/;position:fixed;color:red}</style>",
    present: ["background:url(/*)*/;", "color:red"],
    absent: ["fixed"],
    removed: [{ kind: "css", name: "position" }],
  },
  {
    tc: "TC-note-705",
    title: "drops position hidden behind url() inside a nested at-rule",
    input:
      "<style>@media print{.a{background:url(y/*);position:fixed}}</style>",
    present: ["@media print{", "background:url(y/*);"],
    absent: ["fixed"],
    removed: [{ kind: "css", name: "position" }],
  },
  {
    tc: "TC-note-705",
    title: "drops position after a url() whose ident is written escaped",
    // `\75 rl(` is a url-token to a browser, so the `url` the scan matches
    // has to be the escape-resolved ident and not the source spelling.
    input: "<style>.a{background:\\75 rl(x/*);position:fixed}</style>",
    present: ["background:\\75 rl(x/*);"],
    absent: ["fixed"],
    removed: [{ kind: "css", name: "position" }],
  },
  // A quote right after the `(` is the one branch where the browser keeps
  // tokenising, so the string has to stay a string here.
  {
    tc: "TC-note-707",
    title: "drops position after a double-quoted url()",
    input: '<style>.a{background:url("x/*");position:fixed}</style>',
    present: ['background:url("x/*");'],
    absent: ["fixed"],
    removed: [{ kind: "css", name: "position" }],
  },
  {
    tc: "TC-note-707",
    title: "drops position after a single-quoted url()",
    input: "<p style=\"background:url('x/*');position:fixed\">x</p>",
    html: "<p style=\"background:url('x/*');\">x</p>",
    removed: [{ kind: "css", name: "position" }],
  },
  {
    tc: "TC-note-710",
    title: "keeps a url() whose value contains a semicolon",
    // The url-token is one lexeme, so the `;` inside it is not a terminator
    // and the declaration after it is not invented.
    input: '<p style="background:url(a;b);color:red">x</p>',
    html: '<p style="background:url(a;b);color:red">x</p>',
    noRemovals: true,
  },
  {
    tc: "TC-note-710",
    title: "keeps a url() an escaped paren carries past its first close",
    // The escape is the one thing still read inside a url-token, so the
    // `)` it swallows does not end the token and the `position` spelled
    // after it is part of the URL rather than a declaration.
    input: '<p style="background:url(a\\);position:fixed);color:red">x</p>',
    html: '<p style="background:url(a\\);position:fixed);color:red">x</p>',
    noRemovals: true,
  },
  {
    tc: "TC-note-709",
    title: "keeps a property a comment splits, which no browser resolves",
    // A comment separates identifiers rather than joining them, so this is
    // an unknown property and not `position` — over-removing here would eat
    // decoration the preserve mode exists to keep.
    input: '<p style="pos/**/ition:fixed">x</p>',
    present: ["pos/**/ition:fixed"],
    noRemovals: true,
  },
  // The value is judged by an allow list, so every indirection a browser
  // resolves after this module has run — `var()`, `env()`, one day `attr()`
  // — falls out without being enumerated.
  {
    tc: "TC-note-705",
    title: "drops position whose value is var(), which resolves to fixed",
    input: '<p style="position:var(--x)">x</p>',
    html: "<p>x</p>",
    removed: [{ kind: "css", name: "position" }],
  },
  {
    tc: "TC-note-705",
    title: "drops a var() overlay that a custom property resolves to fixed",
    input:
      "<style>:host{--x:fixed}" +
      ".o{position:var(--x);top:0;left:0;width:100%;height:100%}</style>",
    present: ["--x:fixed", "top:0"],
    absent: ["position"],
    removed: [{ kind: "css", name: "position" }],
  },
  {
    tc: "TC-note-705",
    title: "drops position written with an upper-case VAR()",
    input: '<p style="position:VAR(--x)">x</p>',
    html: "<p>x</p>",
    removed: [{ kind: "css", name: "position" }],
  },
  {
    tc: "TC-note-705",
    title: "drops position whose var() names fixed as its fallback",
    input: '<p style="position:var(--x,fixed)">x</p>',
    html: "<p>x</p>",
    removed: [{ kind: "css", name: "position" }],
  },
  {
    tc: "TC-note-708",
    title: "drops position whose value is env(), the same shape as var()",
    input: '<p style="position:env(--x);color:red">x</p>',
    html: '<p style="color:red">x</p>',
    removed: [{ kind: "css", name: "position" }],
  },
  {
    title: "drops an unlisted position value, since only the browser resolves",
    // No ledger row: this is the allow list's own consequence rather than a
    // rule of ADR 013. An unknown value is inert in the browser anyway, so
    // removing it costs no decoration.
    input: '<p style="position:absolutely">x</p>',
    html: "<p>x</p>",
    removed: [{ kind: "css", name: "position" }],
  },
  {
    title: "keeps the global keywords, which cannot resolve to fixed",
    input: '<p style="position:inherit">a</p><p style="position:unset">b</p>',
    present: ["position:inherit", "position:unset"],
    noRemovals: true,
  },
  {
    tc: "TC-note-710",
    title: "keeps a style element and a style attribute with no banned rule",
    input: '<style>.a{color:red}</style><p style="color:blue">x</p>',
    present: ["<style>", "color:red", 'style="color:blue"'],
    noRemovals: true,
    hasDecoration: true,
  },
  // A raw newline ends a string as a bad-string-token and is re-consumed
  // as the next token (CSS Syntax § consume-a-string-token), so what
  // follows really is a declaration of its own. A scan that hunted for
  // the closing quote to the end of the input would hand the whole run
  // over as one `content` declaration and let the overlay through.
  //
  // The newline is also part of what is written back. The exact output
  // is the claim in these cases rather than a fragment of it: writing
  // `content:"a;` — the string re-opened, because the only thing that
  // closed it was trimmed — leaves every rule after it inside a value,
  // so a substring assertion can hold while the decoration it names is
  // gone from the page.
  {
    tc: "TC-note-823",
    title: "keeps the rules after a string a newline ends, and drops position",
    input:
      '<style>.o{content:"a\n;position:fixed;top:0}\n.p{color:red}\n.q{font-weight:bold}</style>',
    html: '<style>.o{content:"a\n;top:0}.p{color:red}.q{font-weight:bold}</style>',
    removed: [{ kind: "css", name: "position" }],
  },
  {
    tc: "TC-note-823",
    title: "carries a newline-ended string through when nothing is removed",
    // The case that reports nothing: with the newline trimmed away, the
    // sanitizer was the one breaking the page, and `removed` — which is
    // what ED-03 shows the author — stayed empty while `.p` disappeared.
    input: '<style>.o{content:"a\n;color:blue}\n.p{color:red}</style>',
    html: '<style>.o{content:"a\n;color:blue}.p{color:red}</style>',
    noRemovals: true,
  },
  {
    tc: "TC-note-823",
    title: "carries a newline-ended string in a rule's prelude through",
    input: '<style>.o"a\n{color:blue}\n.p{color:red}</style>',
    html: '<style>.o"a\n{color:blue}.p{color:red}</style>',
    noRemovals: true,
  },
  {
    tc: "TC-note-823",
    title: "drops position after a style attribute string a newline ends",
    input: '<p style="content:\'a\n;position:fixed;top:0">x</p>',
    html: '<p style="content:\'a\n;top:0">x</p>',
    removed: [{ kind: "css", name: "position" }],
  },
  {
    tc: "TC-note-823",
    title: "drops position after a string a carriage return ends",
    // The HTML parser normalizes CR to LF before the CSS is ever read,
    // so what is written back is the newline the tree holds.
    input: '<style>.o{content:"a\r;position:fixed}</style>',
    html: '<style>.o{content:"a\n;}</style>',
    absent: ["fixed"],
    removed: [{ kind: "css", name: "position" }],
  },
  {
    tc: "TC-note-823",
    title: "drops position after a string a form feed ends",
    input: '<style>.o{content:"a\f;position:fixed}</style>',
    html: '<style>.o{content:"a\f;}</style>',
    absent: ["fixed"],
    removed: [{ kind: "css", name: "position" }],
  },
  {
    tc: "TC-note-823",
    title: "drops position in the rule after one a newline-ended string left",
    input: '<style>div{content:"a\n} .x{position:fixed}</style>',
    html: '<style>div{content:"a\n}.x{}</style>',
    absent: ["fixed"],
    removed: [{ kind: "css", name: "position" }],
  },
  {
    tc: "TC-note-823",
    title: "keeps a string a backslash continues onto the next line",
    // The escape swallows the newline, so this is one string and the
    // bad-string rule never applies to it.
    input: '<style>.a{content:"a\\\nb";color:red}</style>',
    present: ['content:"a\\\nb";', "color:red"],
    noRemovals: true,
  },
  {
    tc: "TC-note-824",
    title: "keeps the rest of a rule whose function token is not url()",
    // `myurl(` is a function token to a browser, not a url-token, so the
    // `;` inside it terminates nothing. Reading it as a url-token splits
    // the declaration, drops the half holding `position:fixed`, and
    // carries that half's `)` away — leaving `color:red` inside an
    // unclosed function token.
    input: "<style>.a{background:myurl(a(b);position:fixed);color:red}</style>",
    html: "<style>.a{background:myurl(a(b);position:fixed);color:red}</style>",
    noRemovals: true,
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
  // CSS is *not* repaired the way HTML is. A statement the scanner never
  // saw terminated is written back as it was found, because a supplied
  // terminator would land inside the construct that swallowed the scan and
  // the next pass would add another one (see `css.ts`).
  {
    title: "carries an unterminated CSS string through without terminating it",
    input: '<style>.a{content:"</style>',
    html: '<style>.a{content:"</style>',
    noRemovals: true,
  },
  {
    title:
      "carries a </style> cut out of a CSS string through unchanged, injecting nothing",
    input: '<style>.a{content:"</style><img src=x onerror=alert(1)>"}</style>',
    html: '<style>.a{content:"</style><img src="x">"}',
    removed: [{ kind: "attribute", name: "onerror" }],
  },
  {
    title: "carries an unclosed CSS paren through without terminating it",
    input: "<style>.a{color:rgb(1</style>",
    html: "<style>.a{color:rgb(1</style>",
    noRemovals: true,
  },
  {
    title:
      "carries an unterminated string in a style attribute through unchanged",
    input: '<p style="content:\'x">t</p>',
    html: '<p style="content:\'x">t</p>',
    noRemovals: true,
  },
  {
    title:
      "drops the namespace declarations of an inline svg under their real names",
    input:
      '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><use xlink:href="#a"/></svg>',
    html: '<svg><use xlink:href="#a"></use></svg>',
    removed: [
      { kind: "attribute", name: "xmlns" },
      { kind: "attribute", name: "xmlns:xlink" },
    ],
  },
];

const namedSanitizeCases = sanitizeCases.map((testCase) => ({
  ...testCase,
  name:
    testCase.tc === undefined
      ? testCase.title
      : `${testCase.tc}: ${testCase.title}`,
}));

describe("HtmlProcessor.process — ADP-note-001 sanitize allow-list (spec/adr/013)", () => {
  it.each(namedSanitizeCases)("$name", (testCase) => {
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

/**
 * Bodies are re-sanitized from storage — `applyTextNodeEdits` on every
 * autosave, `restoreNoteRevision`, `listNoteRevisions` — so `process` has
 * to be a fixed point. A second pass that changes anything makes a body
 * drift with no user edit behind it, and the drift shows up in neither
 * `removed` nor the screen.
 */
describe("HtmlProcessor.process — ADP-note-001 is a fixed point", () => {
  const inputs = [
    ...sanitizeCases.map(({ input }) => input),
    "<h1>One</h1><h2>Two</h2><h2>Two</h2>",
    '<link rel="stylesheet" href="https://cdn.example/x.css">',
    "<style>@media (min-width:1px){.a{position:fixed;color:red}}</style>",
    // An escaped quote or paren the scan has to consume as one lexeme: a
    // pass that took either as opening a construct would find no
    // terminator, and the terminator it supplied would land inside it.
    "<style>.a{background:url\\(a</style>",
    '<style>.a{content:\\"</style>',
    "<style>.a{content:\\</style>",
    // A url-token the input never closes: the scan runs to the end without
    // a terminator, so none may be written back.
    "<style>.a{background:url(x/*</style>",
    "<style>.a{background:url(x/*)</style>",
  ];

  it.each(inputs.map((input, index) => ({ index, input })))(
    "$index: $input",
    ({ input }) => {
      const once = processor.process(input).html;
      expect(processor.process(once).html).toBe(once);
    },
  );
});

/**
 * The ceilings of spec/adr/013 「サニタイズは資源で有界である」. Nothing
 * here reasons about the shape of the input: the adapter meters what it
 * spends and refuses to spend more. Every case below is an input that
 * costs super-linearly without a ceiling, with the measured cost.
 */
describe("HtmlProcessor.process — ADP-note-001 is bounded by resources", () => {
  const rejection = (input: string): BusinessRuleError<string> => {
    let thrown: unknown;
    try {
      processor.process(input);
    } catch (error) {
      thrown = error;
    }
    // Named rather than `toThrow`: a `RangeError` is what this ceiling
    // exists to replace, and it would satisfy a bare `toThrow`.
    expect(thrown).toBeInstanceOf(BusinessRuleError);
    return thrown as BusinessRuleError<string>;
  };

  /**
   * The cheapest of three runs. What the growth cases compare is a
   * complexity class, and a single run of an input this size carries the
   * garbage collector's noise.
   */
  const cost = (input: string): number => {
    let best = Number.POSITIVE_INFINITY;
    for (let run = 0; run < 3; run += 1) {
      const started = performance.now();
      processor.process(input);
      best = Math.min(best, performance.now() - started);
    }
    return best;
  };

  it("TC-note-817: refuses nesting past the limit instead of overflowing", () => {
    // Unbounded, 22 KB raises `RangeError: Maximum call stack size
    // exceeded`, which carries no `kind` and so reaches the transport
    // boundary unclassified.
    const error = rejection("<div>".repeat(2_000));

    expect(error.code).toBe("NOTE_HTML_TOO_COMPLEX");
    expect(error.toSerialized().kind).toBe("business");
  });

  it("TC-note-817: refuses deep nesting without building the tree first", () => {
    // 550 KB of nesting took 21 seconds inside the parser before any code
    // of ours saw the tree, so the refusal has to reach the parse itself.
    const started = Date.now();
    rejection("<div>".repeat(50_000));

    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it("TC-note-818: accepts nesting exactly at the limit", () => {
    const at = "<div>".repeat(256);

    expect(processor.process(at).html).toBe(`${at}${"</div>".repeat(256)}`);
  });

  it("TC-note-818: refuses nesting one level past the limit", () => {
    expect(rejection("<div>".repeat(257)).code).toBe("NOTE_HTML_TOO_COMPLEX");
  });

  it("TC-note-819: refuses CSS blocks nested past the limit", () => {
    // 108 KB of `@media a{` burned 26 seconds and then overflowed: finding
    // the end of a block re-reads it, so nesting makes the scan quadratic.
    const error = rejection(`<style>${"@media a{".repeat(12_000)}</style>`);

    expect(error.code).toBe("NOTE_HTML_TOO_COMPLEX");
  });

  it("TC-note-820: accepts CSS blocks exactly at the nesting limit", () => {
    const at = `<style>${"@media a{".repeat(32)}color:red</style>`;

    expect(processor.process(at).html).toBe(at);
  });

  it("TC-note-820: refuses CSS blocks one level past the nesting limit", () => {
    expect(
      rejection(`<style>${"@media a{".repeat(33)}color:red</style>`).code,
    ).toBe("NOTE_HTML_TOO_COMPLEX");
  });

  it("TC-note-821: refuses a stylesheet that asks for more scanning than the budget", () => {
    // Inside the nesting limit, but every one of the 32 enclosing blocks
    // re-reads the 300 KB body while looking for its own end.
    const error = rejection(
      `<style>${"@media a{".repeat(32)}${"color:red;".repeat(30_000)}</style>`,
    );

    expect(error.code).toBe("NOTE_HTML_TOO_COMPLEX");
  });

  const fosterRows = (rows: number, fonts: number): string =>
    Array.from({ length: fonts }, (_, i) => `<font a="${i}">`).join("") +
    "<tr>X</tr>".repeat(rows);

  it("TC-note-822: refuses a body the parser expands past the allowance", () => {
    // Foster parenting re-constructs the open formatting elements once per
    // row, so the tree grows as rows × fonts while the source grows as
    // rows + fonts. No tag is left unclosed and nothing nests deeply.
    const error = rejection(`<table><tr>${fosterRows(3_000, 60)}</table>`);

    expect(error.code).toBe("NOTE_HTML_TOO_COMPLEX");
  });

  it("TC-note-822: refuses the same expansion reached through an svg integration point", () => {
    // `<desc>` resumes HTML parsing and "in template" reaches the table
    // insertion modes with no `<table>` start tag, so an allow list of
    // element names does not close this route — the meter does.
    const error = rejection(
      `<svg><desc><template><tr>${fosterRows(3_000, 60)}</template></desc></svg>`,
    );

    expect(error.code).toBe("NOTE_HTML_TOO_COMPLEX");
  });

  it("TC-note-825: still processes an expansion that stays inside the allowance", () => {
    const result = processor.process(`<table><tr>${fosterRows(20, 5)}</table>`);

    expect(result.html).toContain("<table>");
  });

  it("TC-note-826: accepts a flat body at the node ceiling and refuses one node past it", () => {
    // Nothing else is near: 200,000 bytes expanding 1.0×, nesting one
    // deep, holding no CSS. Only the node count separates the two.
    expect(processor.process("<br>".repeat(50_000)).html).toHaveLength(200_000);

    expect(rejection("<br>".repeat(50_001)).code).toBe("NOTE_HTML_TOO_COMPLEX");
  });

  it("TC-note-826: holds the node ceiling on the parse path a form or a closed template takes", () => {
    // These two constructs are the ones whose parse depends on an open
    // `<template>`, so they are parsed plainly — which is the path that
    // still moves each top-level node out of the parse root one at a
    // time. The ceiling has to be the same one there, or a 13-byte
    // prefix buys the quadratic back.
    for (const prefix of ["<form></form>", "</template>"]) {
      expect(rejection(`${prefix}${"<br>".repeat(50_001)}`).code).toBe(
        "NOTE_HTML_TOO_COMPLEX",
      );
    }
  });

  it("TC-note-826: refuses the flat body the transport ceiling admits without paying for it", () => {
    // 1,760,000 bytes of `<br>` expand 1.0×, nest one deep and hold no
    // CSS, and are refused for the node count alone. The two prefixes
    // route the same body onto the plain path, where the parse is
    // quadratic: 364 ms wrapped against 16,477 ms and 82,347 ms plainly,
    // all three on an input that could never have been stored.
    for (const input of [
      "<br>".repeat(440_000),
      `</template>${"<br>".repeat(440_000)}`,
      `<form></form>${"<br>".repeat(440_000)}`,
    ]) {
      const started = Date.now();

      expect(rejection(input).code).toBe("NOTE_HTML_TOO_COMPLEX");
      expect(Date.now() - started).toBeLessThan(2_000);
    }
  });

  it("TC-note-826: costs no more than its length asks for, up to the node ceiling", () => {
    // What is asserted is the growth rather than a wall clock, because
    // the defect it holds off is a complexity class rather than a
    // constant: parse5 moves every top-level node out of the parse root
    // one at a time, which is quadratic in how many there are, and the
    // `<template>` the parse is wrapped in is what keeps them out of that
    // root. A tenth of the body is the yardstick, taken at the ceiling
    // where the two curves are furthest apart — ten times the nodes
    // measured 10.9–21.8× the time here, against 89–150× when they are
    // moved one at a time — and both measurements move together on a
    // slower or busier machine.
    const tenthCost = cost("<br>".repeat(5_000));

    expect(cost("<br>".repeat(50_000))).toBeLessThan(tenthCost * 45);
  });

  it("TC-note-828: resolves duplicate heading anchors without re-trying the suffixes it passed", () => {
    // Restarting each heading search at `-2` costs the square of the
    // number of identical headings, inside every ceiling: 16,000 take
    // 7.4 seconds and 120,000 never finish. The ids are the claim as
    // much as the time — resuming the count must hand out the same ones,
    // in the same order.
    const headings = (count: number): string => "<h1>a</h1>".repeat(count);
    const manyCost = cost(headings(16_000));
    const result = processor.process(headings(16_000));

    expect(result.headings.slice(0, 3).map(({ anchorId }) => anchorId)).toEqual(
      ["a", "a-2", "a-3"],
    );
    expect(result.headings[15_999]?.anchorId).toBe("a-16000");
    expect(result.html).toContain('<h1 id="a-16000">a</h1>');
    // A wall clock rather than a ratio: 16,000 headings measure 29\u201393 ms
    // resumed and 28,201 ms restarted, so the two sit an order of
    // magnitude away from this bound on either side.
    expect(manyCost).toBeLessThan(3_000);
  });

  it("TC-note-829: refuses a mass of siblings under an unlisted element instead of overflowing", () => {
    // Unwrapping an unlisted element hands all of its children back at
    // once; 130,000 of them (520 KB) raised `RangeError`, which has no
    // `toSerialized()` and reaches the transport boundary unclassified.
    // Nothing here nests past two levels, so the depth ceiling never saw
    // it.
    const error = rejection(`<foo>${"<br>".repeat(130_000)}</foo>`);

    expect(error.code).toBe("NOTE_HTML_TOO_COMPLEX");
    expect(error.toSerialized().kind).toBe("business");
  });

  it("TC-note-829: unwraps the widest mass of siblings the ceiling admits", () => {
    // The unwrap itself, at the ceiling: 49,999 children promoted to the
    // root beside the element that held them.
    const at = "<br>".repeat(49_999);

    expect(processor.process(`<foo>${at}</foo>`).html).toBe(at);
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

  it("names the dropped xmlns declarations exactly, with no :xmlns among them", () => {
    // parse5 gives a bare `xmlns` the empty prefix rather than none, so the
    // reported name is what AC-3 shows the user: an attribute that exists.
    const result = processor.process(
      '<p><svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><use xlink:href="#a"/></svg></p>',
    );
    expect(result.removed).toEqual([
      expect.objectContaining({ kind: "attribute", name: "xmlns" }),
      expect.objectContaining({ kind: "attribute", name: "xmlns:xlink" }),
    ]);
    expect(result.html).toBe('<p><svg><use xlink:href="#a"></use></svg></p>');
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

  it("applies the CSS rules to fetched CSS, which no later step re-sanitizes", () => {
    const inlined = processor.inlineStylesheets(
      body,
      new Map([
        [
          "https://cdn.example/x.css",
          "@import url(https://evil.example/y.css);.o{position:fixed;color:red}",
        ],
      ]),
      new Set(),
    );

    expect(inlined).not.toContain("@import");
    expect(inlined).not.toContain("position:fixed");
    expect(inlined).toContain("color:red");
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
      '<p class="c" style="color:red">A<b>bold</b>c</p>',
    );
  });

  it("TC-note-002: leaves class and style attributes in place", () => {
    const result = processor.editTextNodes(body, [
      { path: "0.1.0", expected: "bold", text: "BOLD" },
    ]);
    expect(result.html).toBe(
      '<p class="c" style="color:red">a<b>BOLD</b>c</p><style>.x{color:red}</style>',
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
      '<p class="c" style="color:red"><b>bold</b>c</p>',
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
        expected: ".x{color:red}",
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
