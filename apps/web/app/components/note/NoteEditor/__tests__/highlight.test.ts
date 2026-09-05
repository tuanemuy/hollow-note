import { describe, expect, it } from "vitest";
import {
  type HtmlToken,
  markupStructure,
  sameMarkupStructure,
  tokenizeHtml,
} from "../highlight";

const kinds = (source: string, kind: HtmlToken["kind"]): string[] =>
  tokenizeHtml(source)
    .filter((token) => token.kind === kind)
    .map((token) => token.text);

/** 色分けは書き換えではないので、トークンを連結すると元へ戻る。 */
const roundTrip = (source: string): string =>
  tokenizeHtml(source)
    .map((token) => token.text)
    .join("");

describe("tokenizeHtml", () => {
  it.each([
    `<p class="a">hello</p>`,
    `<p class='a'>hello</p>`,
    `<img src=x alt="a < b">`,
    "a < b and 1 > 2",
    "<!-- comment --><p>x",
    `<p title="a > b">x</p>`,
    "<!DOCTYPE html><p>x</p>",
    "<p",
    "",
  ])("loses nothing from %j", (source) => {
    expect(roundTrip(source)).toBe(source);
  });

  it("does not end a tag on a `>` inside a quoted attribute value", () => {
    expect(kinds(`<p title="a > b">x</p>`, "value")).toEqual([`"a > b"`]);
    expect(kinds(`<p title="a > b">x</p>`, "tag")).toEqual(["p", "p"]);
  });

  it("leaves a bare `<` as text rather than opening a tag", () => {
    expect(kinds("a < b", "tag")).toEqual([]);
    expect(kinds("a < b", "text")).toEqual(["a < b"]);
  });

  it("keeps a comment whole, including markup inside it", () => {
    expect(kinds("<!-- <p>x</p> -->", "comment")).toEqual([
      "<!-- <p>x</p> -->",
    ]);
    expect(kinds("<!-- <p>x</p> -->", "tag")).toEqual([]);
  });

  it("colours an unterminated comment to the end of the source", () => {
    expect(kinds("<!-- unclosed", "comment")).toEqual(["<!-- unclosed"]);
  });

  it("colours an unclosed tag instead of giving up on it", () => {
    expect(kinds(`<p class="a"`, "tag")).toEqual(["p"]);
    expect(kinds(`<p class="a"`, "attr")).toEqual(["class"]);
  });

  it("colours an attribute with no value and one with no quotes", () => {
    expect(kinds("<input disabled name=a>", "attr")).toEqual([
      "disabled",
      "name",
    ]);
    expect(kinds("<input disabled name=a>", "value")).toEqual(["a"]);
  });

  it("merges adjacent tokens of the same kind", () => {
    // `span` を文字数ぶん作らないための性質。素の不等号を挟んだ散文は
    // 1 つのテキストに畳む。
    const tokens = tokenizeHtml("a < b < c");
    expect(tokens).toEqual([{ kind: "text", text: "a < b < c" }]);
  });
});

describe("markupStructure", () => {
  it("reads element and attribute names only, in lower case", () => {
    expect(markupStructure(`<P CLASS='a'>hi &amp; bye</P>`)).toEqual([
      "p",
      "class",
      "p",
    ]);
  });

  it("ignores comments, doctypes and text", () => {
    expect(markupStructure("<!DOCTYPE html><!-- x -->text")).toEqual([]);
  });
});

describe("sameMarkupStructure", () => {
  it.each([
    ["self-closing notation", "<br/>", "<br>"],
    ["tag name case", "<P>x</P>", "<p>x</p>"],
    ["attribute quoting", `<p class='a'>x</p>`, `<p class="a">x</p>`],
    ["omitted quotes", "<img src=x>", `<img src="x">`],
    ["entity spelling", "<p>&#x27;</p>", "<p>'</p>"],
    ["whitespace inside the tag", `<p  class="a" >x</p>`, `<p class="a">x</p>`],
  ])("treats %s as the same markup", (_label, left, right) => {
    expect(sameMarkupStructure(left, right)).toBe(true);
  });

  it.each([
    ["an unclosed tag", "<p>x", "<p>x</p>"],
    [
      "a nesting violation",
      "<p><div>x</div></p>",
      "<p></p><div>x</div><p></p>",
    ],
    [
      "an implied tbody",
      "<table><tr><td>x</td></tr></table>",
      "<table><tbody><tr><td>x</td></tr></tbody></table>",
    ],
    ["a dropped duplicate attribute", `<p a="1" a="2">x</p>`, `<p a="1">x</p>`],
    ["a different attribute name", `<p a="1">x</p>`, `<p b="1">x</p>`],
  ])("treats %s as repaired markup", (_label, left, right) => {
    expect(sameMarkupStructure(left, right)).toBe(false);
  });
});
