/**
 * HTML ソースの色分け（ED-03 手順 2「シンタックスハイライト付きのソース
 * エディタ」）。
 *
 * ライブラリを足さずに書いてある。必要なのは 1 言語ぶんの色分けで、
 * `spec/design/index.md` の `--code-*` トークンが既に配色を決めており、
 * 汎用ハイライターを入れると言語定義とテーマの両方を持ち込むことになる。
 * 出力はトークン列なので、面（`surfaces.tsx`）が `span` に落とす。
 *
 * 走査は HTML パーサーではない。壊れた構文（閉じていないタグ・引用符の
 * 無い属性値）もそのまま色が付く形にしてあり、補正は保存側の
 * `HtmlProcessor` が行う。
 */

export type HtmlTokenKind =
  | "text"
  | "punct"
  | "tag"
  | "attr"
  | "value"
  | "comment";

export type HtmlToken = Readonly<{ kind: HtmlTokenKind; text: string }>;

/**
 * これを超える長さは色分けしない。トークン 1 つが `span` 1 つになるので、
 * 本文の上限（サニタイズ後 800 KB）に近いソースを色分けすると DOM が
 * 数十万ノードになり、打鍵のたびに固まる。上限を超えた場合は素のまま
 * 表示する — 色が無いことより、書けないことのほうが重い。
 */
export const HIGHLIGHT_MAX_LENGTH = 60_000;

const TAG_NAME = /^[a-zA-Z][\w:.-]*/;

/** 属性名 = 値 / 単独の属性名 / それ以外の 1 文字。 */
const TAG_REST =
  /([^\s=/>"'<]+)(\s*=\s*)("[^"]*"?|'[^']*'?|[^\s/>"'<]*)|([^\s=/>"'<]+)|([\s\S])/g;

class TokenList {
  private readonly tokens: HtmlToken[] = [];

  push(kind: HtmlTokenKind, text: string): void {
    if (text.length === 0) return;
    const last = this.tokens.at(-1);
    // 同種が隣り合ったら 1 つにまとめる。まとめないと、記号ばかりの
    // ソースで `span` の数が文字数に比例する。
    if (last !== undefined && last.kind === kind) {
      this.tokens[this.tokens.length - 1] = {
        kind,
        text: last.text + text,
      };
      return;
    }
    this.tokens.push({ kind, text });
  }

  result(): readonly HtmlToken[] {
    return this.tokens;
  }
}

/** 引用符の中の `>` を終端と見なさずにタグの終わりを探す。 */
function findTagEnd(source: string, from: number): number {
  let quote: string | null = null;
  for (let i = from + 1; i < source.length; i += 1) {
    const char = source[i];
    if (quote !== null) {
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === ">") return i;
  }
  return -1;
}

function pushTag(tokens: TokenList, raw: string): void {
  const head = raw.startsWith("</") ? "</" : "<";
  tokens.push("punct", head);
  const rest = raw.slice(head.length);
  const name = TAG_NAME.exec(rest);
  if (name === null) {
    tokens.push("punct", rest);
    return;
  }
  tokens.push("tag", name[0]);

  const attributes = rest.slice(name[0].length);
  TAG_REST.lastIndex = 0;
  let match = TAG_REST.exec(attributes);
  while (match !== null) {
    if (match[1] !== undefined) {
      tokens.push("attr", match[1]);
      tokens.push("punct", match[2] ?? "");
      tokens.push("value", match[3] ?? "");
    } else if (match[4] !== undefined) {
      tokens.push("attr", match[4]);
    } else {
      const char = match[5] ?? "";
      tokens.push(/\s/.test(char) ? "text" : "punct", char);
    }
    match = TAG_REST.exec(attributes);
  }
}

export function tokenizeHtml(source: string): readonly HtmlToken[] {
  const tokens = new TokenList();
  let index = 0;

  while (index < source.length) {
    const open = source.indexOf("<", index);
    if (open < 0) {
      tokens.push("text", source.slice(index));
      break;
    }
    tokens.push("text", source.slice(index, open));

    if (source.startsWith("<!--", open)) {
      const close = source.indexOf("-->", open + 4);
      const stop = close < 0 ? source.length : close + 3;
      tokens.push("comment", source.slice(open, stop));
      index = stop;
      continue;
    }

    const next = source[open + 1] ?? "";
    // `a < b` のような素の不等号はタグではない。
    if (!/[a-zA-Z/!?]/.test(next)) {
      tokens.push("text", "<");
      index = open + 1;
      continue;
    }

    if (next === "!" || next === "?") {
      const close = source.indexOf(">", open);
      const stop = close < 0 ? source.length : close + 1;
      tokens.push("comment", source.slice(open, stop));
      index = stop;
      continue;
    }

    const close = findTagEnd(source, open);
    if (close < 0) {
      pushTag(tokens, source.slice(open));
      break;
    }
    pushTag(tokens, source.slice(open, close));
    tokens.push("punct", ">");
    index = close + 1;
  }

  return tokens.result();
}
