/**
 * ビジュアルモード（ED-02）の経路づけ。
 *
 * 経路の規約は `HtmlProcessor` のポート契約が正典 — **body ルートからの
 * ドット区切り 0 始まり子インデックス**で、数え方は `childNodes`（要素も
 * テキストも空白も 1 つ）である。`<style>` / `<script>` の中身には経路を
 * 割り当てない（[ADR 013](spec/adr/013-html-sanitization-policy.md) の
 * 迂回防止）。ここが `adapters/html/htmlProcessor.ts` の
 * `resolveTextNode` と食い違うと、編集が全件 `pathNotFound` に落ちる。
 */

export type EditableTextNode = Readonly<{
  path: string;
  node: Text;
  text: string;
}>;

const isPathOpaque = (element: Element): boolean =>
  element.namespaceURI !== "http://www.w3.org/2000/svg" &&
  (element.localName === "style" || element.localName === "script");

/**
 * 本文を編集可能なテキストノードの一覧へ展開する。空白だけのノードは
 * 落とす — 構造の隙間まで編集欄にすると、要素の追加に見える操作面が
 * 生まれてしまう。落としても経路は動かない（インデックスは元の
 * `childNodes` で数える）。
 */
export function collectEditableTextNodes(root: ParentNode): EditableTextNode[] {
  const found: EditableTextNode[] = [];
  const walk = (parent: ParentNode, prefix: readonly number[]): void => {
    const children = parent.childNodes;
    for (let index = 0; index < children.length; index += 1) {
      const child = children[index];
      if (child === undefined) continue;
      const path = [...prefix, index];
      if (child.nodeType === Node.TEXT_NODE) {
        const text = child.nodeValue ?? "";
        if (text.trim().length > 0) {
          found.push({ path: path.join("."), node: child as Text, text });
        }
        continue;
      }
      if (child.nodeType !== Node.ELEMENT_NODE) continue;
      const element = child as Element;
      if (isPathOpaque(element)) continue;
      walk(element, path);
    }
  };
  walk(root, []);
  return found;
}

export type TextNodeEditPayload = Readonly<{
  path: string;
  expected: string;
  text: string;
}>;

/** 実際に変わったノードだけを送る。無編集の保存は版を 1 つ無駄にする。 */
export function diffTextNodeEdits(
  original: ReadonlyMap<string, string>,
  current: ReadonlyMap<string, string>,
): TextNodeEditPayload[] {
  const edits: TextNodeEditPayload[] = [];
  for (const [path, expected] of original) {
    const text = current.get(path);
    if (text !== undefined && text !== expected) {
      edits.push({ path, expected, text });
    }
  }
  return edits;
}
