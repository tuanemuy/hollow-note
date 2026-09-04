"use client";

import {
  filterAllowedSrcset,
  isAllowedUrl,
} from "@repo/core/domain/note/services/urlPolicy";
import {
  type DragEvent,
  type RefObject,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { Alert } from "@/components/ui/Alert";
import { NoteBody } from "../NoteBody";
import {
  HIGHLIGHT_MAX_LENGTH,
  type HtmlTokenKind,
  sameMarkupStructure,
  tokenizeHtml,
} from "./highlight";
import { collectEditableTextNodes } from "./textNodes";

/**
 * 3 つの書く面（ED-02 / ED-03 / ED-04）。どれも**未保存の内容の持ち主は
 * 親**で、この階層は入力を親へ流すだけにしてある。版と保存の状態を親が
 * 握る（自動保存のたびに版がずれないため）以上、面が自分で保存を呼ぶと
 * 版の出所が 2 か所になる。
 */

const editorSurfaceClass =
  "min-h-[46vh] text-base leading-relaxed outline-none [caret-color:var(--color-accent)]";

// contenteditable な面には既定スタイルが要る（本文の見出し・リストが
// 素のブラウザ表示に落ちると、書いている最中だけ別物に見える）。
const WYSIWYG_CSS = `
[data-hollow-wysiwyg] h1 { font-size: var(--text-2xl); font-weight: 600; letter-spacing: var(--tracking-tighter); margin: var(--space-8) 0 var(--space-4); }
[data-hollow-wysiwyg] h2 { font-size: var(--text-xl); font-weight: 600; letter-spacing: var(--tracking-tighter); margin: var(--space-8) 0 var(--space-4); }
[data-hollow-wysiwyg] h3 { font-size: var(--text-lg); font-weight: 600; margin: var(--space-6) 0 var(--space-3); }
[data-hollow-wysiwyg] p { margin: 0 0 var(--space-5); }
[data-hollow-wysiwyg] ul { list-style: disc; padding-left: 1.4em; margin: 0 0 var(--space-5); }
[data-hollow-wysiwyg] ol { list-style: decimal; padding-left: 1.4em; margin: 0 0 var(--space-5); }
[data-hollow-wysiwyg] li { margin-bottom: var(--space-2); }
[data-hollow-wysiwyg] blockquote { border-left: 3px solid var(--color-hairline-strong); padding-left: var(--space-4); color: var(--color-ink-secondary); margin: 0 0 var(--space-5); }
[data-hollow-wysiwyg] code { font-family: var(--font-mono); font-size: var(--text-mono); background: var(--color-surface); padding: 2px 5px; border-radius: var(--radius-xs); }
[data-hollow-wysiwyg] pre { font-family: var(--font-mono); font-size: var(--text-mono); background: var(--color-surface); border-radius: var(--radius-lg); padding: var(--space-4); overflow-x: auto; margin: 0 0 var(--space-5); }
[data-hollow-wysiwyg] a { color: var(--color-accent); }
[data-hollow-wysiwyg] img, [data-hollow-wysiwyg] video { max-width: 100%; height: auto; border-radius: var(--radius-lg); }
[data-hollow-wysiwyg] table { border-collapse: collapse; width: 100%; margin: 0 0 var(--space-5); font-size: var(--text-sm); }
[data-hollow-wysiwyg] th, [data-hollow-wysiwyg] td { border: 1px solid var(--color-hairline); padding: var(--space-2) var(--space-3); }
`;

/** 本文へファイルを落とせる面が持つハンドラー（ED-06 手順 1）。 */
type DropHandlers = Readonly<{
  onDragOver: (event: DragEvent<Element>) => void;
  onDrop: (event: DragEvent<Element>) => void;
}>;

/**
 * 既定の動作を止めるのは、ブラウザーがファイルをそのまま開くか `blob:`
 * を指す要素を本文へ差し込むためで、どちらも保管を経ないので保存できない。
 * 落ちたファイルは 1 件ずつ親の挿入経路へ流す。
 */
const dropHandlers = (
  onDropFiles: ((files: readonly File[]) => void) | null,
): DropHandlers | undefined =>
  onDropFiles === null
    ? undefined
    : {
        onDragOver: (event) => {
          if (event.dataTransfer.types.includes("Files")) {
            event.preventDefault();
          }
        },
        onDrop: (event) => {
          const files = Array.from(event.dataTransfer.files);
          if (files.length === 0) return;
          event.preventDefault();
          onDropFiles(files);
        },
      };

/**
 * caret の位置にある画像。クリックは `event.target` で足りるが、
 * キーボードだけで操作する利用者にも代替テキストの対象を選ばせる必要が
 * あるので、caret の直前・直後の要素も見る。
 */
const imageAtCaret = (surface: HTMLElement): HTMLImageElement | null => {
  const selection = document.getSelection();
  if (selection === null || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  const { startContainer, startOffset } = range;
  if (!surface.contains(startContainer)) return null;
  if (!(startContainer instanceof Element)) return null;
  const after = startContainer.childNodes[startOffset];
  if (after instanceof HTMLImageElement) return after;
  const before =
    startOffset > 0 ? startContainer.childNodes[startOffset - 1] : undefined;
  return before instanceof HTMLImageElement ? before : null;
};

export function WysiwygSurface({
  baseline,
  editable,
  surfaceRef,
  onChange,
  onSelectImage,
  onDropFiles,
}: {
  /** 外から本文が差し替わったときだけ変わる値（復元・破棄・版の復元）。 */
  baseline: string;
  /**
   * 保存が受け付けられる状態か（P-12 の「処理中で編集できない」「権限
   * 喪失」で `false`）。書けるのに絶対に保存されない面を出すと、書いた
   * 内容がどこにも残らないまま失われる。読み取りは残す（権限喪失では
   * 「内容をダウンロード」から持ち出せる必要がある）。
   */
  editable: boolean;
  surfaceRef: RefObject<HTMLDivElement | null>;
  onChange: (html: string) => void;
  /** 代替テキストの編集対象。親が持つ（属性を書くのは本文の持ち主）。 */
  onSelectImage: (image: HTMLImageElement | null) => void;
  onDropFiles: ((files: readonly File[]) => void) | null;
}) {
  // 本文は React の子ではなくブラウザーが持つ（contenteditable の DOM を
  // React に再描画させると caret が飛ぶ）。差し替えは baseline が変わった
  // ときだけ行う。
  //
  // この面も live DOM なので、載せる前に `scrubForSurface` を通す
  // （`baseline` には未保存の本文が入りうる — 退避の「復元する」）。
  // `<style>` も落とす（この面だけが shadow root の外にあるため。
  // `dropStyleElements` の JSDoc）。
  //
  // 載せるのは scrub した**木そのもの**である。直列化して `innerHTML` へ
  // 入れ直すと、サニタイズした木を別の解析文脈で読み直すことになり、
  // scrub 後に無かった属性が再パースで復活しうる（`<svg>` / `<math>` の
  // 名前空間混同、`<style>` / `<title>` の raw text で属性境界が動く形）。
  // 直列化してよいのは「載せ替えが要るか」の比較だけで、比較した文字列は
  // DOM へ戻さない。
  useEffect(() => {
    const surface = surfaceRef.current;
    if (surface === null) return;
    const template = document.createElement("template");
    template.innerHTML = baseline;
    scrubForSurface(template.content);
    dropStyleElements(template.content);
    if (surface.innerHTML !== template.innerHTML) {
      surface.replaceChildren(template.content);
    }
  }, [baseline, surfaceRef]);

  return (
    <>
      {/** biome-ignore lint/security/noDangerouslySetInnerHtml: 静的な既定スタイル。 */}
      <style dangerouslySetInnerHTML={{ __html: WYSIWYG_CSS }} />
      {/* biome-ignore lint/a11y/useSemanticElements: リッチテキストなので
          `textarea` では置き換えられない（要素を持つ本文を編集する面）。
          `contenteditable` が既にフォーカス可能だが、規則が見るのは
          `tabIndex` なので明示する。 */}
      <div
        data-hollow-wysiwyg=""
        ref={surfaceRef}
        contentEditable={editable}
        suppressContentEditableWarning
        role="textbox"
        tabIndex={0}
        aria-multiline="true"
        aria-readonly={!editable}
        aria-label="本文"
        className={editorSurfaceClass}
        onInput={(event) => onChange(event.currentTarget.innerHTML)}
        // 貼り付けもシードと同じ scrub を通す。ブラウザーが既定で挿す
        // `text/html` は他所の DOM そのままで、`on*` も `<style>` も
        // 載っている。プレーンテキストしか無いときは既定の挿入に任せる。
        //
        // 差し込むのも木そのもので、`insertHTML` は使わない（シードと同じ
        // 理由 — scrub 済みの木を直列化して読み直す窓を作らないため）。
        // 代償として、この貼り付けはブラウザーの取り消し履歴に載らない。
        onPaste={(event) => {
          const html = event.clipboardData.getData("text/html");
          if (html === "") return;
          // 既定の挿入は scrub を通らないので、差し込み先が取れなかった
          // ときは**何も入れない**（既定へ落とさない）。
          event.preventDefault();
          const surface = event.currentTarget;
          const selection = document.getSelection();
          if (selection === null || selection.rangeCount === 0) return;
          const range = selection.getRangeAt(0);
          if (!surface.contains(range.commonAncestorContainer)) return;
          const template = document.createElement("template");
          template.innerHTML = html;
          scrubForSurface(template.content);
          dropStyleElements(template.content);
          // caret は差し込んだ最後のノードの直後へ置く（`insertNode` は
          // fragment を空にするので、末尾の目印は先に控える）。
          const tail = template.content.lastChild;
          range.deleteContents();
          range.insertNode(template.content);
          if (tail !== null) {
            const after = document.createRange();
            after.setStartAfter(tail);
            after.collapse(true);
            selection.removeAllRanges();
            selection.addRange(after);
          }
          onChange(surface.innerHTML);
        }}
        onClick={(event) =>
          onSelectImage(
            event.target instanceof HTMLImageElement
              ? event.target
              : imageAtCaret(event.currentTarget),
          )
        }
        onKeyUp={(event) => onSelectImage(imageAtCaret(event.currentTarget))}
        {...dropHandlers(onDropFiles)}
      />
    </>
  );
}

/** 色分けとソースの字送りは 1 か所で決める（ずれると桁が合わない）。 */
const sourceTypeClass =
  "font-mono text-[length:var(--text-mono)] leading-[1.7] whitespace-pre-wrap [overflow-wrap:anywhere]";

const TOKEN_CLASS: Readonly<Record<HtmlTokenKind, string>> = {
  text: "",
  punct: "text-ink-tertiary",
  tag: "text-[var(--code-keyword)]",
  attr: "text-[var(--code-function)]",
  value: "text-[var(--code-string)]",
  comment: "text-[var(--code-comment)]",
};

const REPAIR_CHECK_DELAY_MS = 500;

/**
 * live DOM に入れてよい形へ落とすときに消えるもの。**3 つの面はどれも
 * live DOM**（HTML のプレビューと ビジュアルは shadow root、WYSIWYG は
 * `contenteditable` の本体）なので、保存前の本文をそのまま入れると
 * `<img onerror>` のようなハンドラーがこの画面で走る — Shadow DOM が
 * 隔離するのはスタイルだけで、配信している CSP にも `script-src` は無い。
 * 未保存の本文が面へ入る経路は実在する（退避データの「復元する」）。
 *
 * 落とす対象は保存時のサニタイズ（`HtmlProcessor`）が落とすものの部分
 * 集合なので、面は「実際に保存される形」から外れる向きには動かない
 * （落ちるものはどのみち保存で落ちる）。逆に言えば面は保存後の姿では
 * ない — 許可リスト外の要素・属性・CSS 宣言はここでは残る。
 *
 * 残るものが面の外へ出ないことを担保しているのは**面ごとに違う**。
 * ビジュアルと HTML のプレビューは shadow root なので、本文の
 * `<style>` が持つセレクターの到達範囲はそこで閉じる。ただし
 * `:host { … !important }` だけはホスト要素に当たり、`!important` では
 * 内側の木が勝つので shadow root では閉じない。どちらの面もホストを
 * `contain: layout paint` の**親**で包んでいるのはそのためで、これは
 * レイアウトと描画の閉じ込め（`position: fixed` の包含ブロックになる）
 * であって、**セレクターの到達範囲は閉じない**。WYSIWYG だけは
 * shadow root でも `contain` でもないので、`<style>` を別途落とす
 * （`dropStyleElements`）。
 *
 * 未保存の本文が live DOM へ入る経路はすべてこれを通す — 3 つの面の
 * シードに加え、WYSIWYG の貼り付けも通る。木を渡す形にしてあるのは、
 * 面ごとに通す位置が違うためである — ビジュアルは経路を数え終えたあと、
 * HTML のプレビューは構文補正の判定を取ったあとになる。面へ markup を
 * 差し込む残り 2 経路（`insertHTML` の仮の要素とメディア、`createLink`）
 * は親（`editor.tsx`）が組み立てる値で、属性は組み立てる側が
 * エスケープし、URL は組み立てる側がスキームで絞る。
 *
 * 落とし方も保存側に揃える。保存は「子ごと落とす集合」
 * （`adapters/html/allowList.ts` の `DROP_WITH_CONTENT`）とそれ以外の
 * unwrap に分かれるので、面も 2 つの集合に分ける。片側だけで済ませると
 * `form` のように「保存は散文を残すのに面は消す」要素が出る。
 */
const UNSAFE_DROP_ELEMENTS = new Set([
  "script",
  "noscript",
  "iframe",
  "object",
  "embed",
]);

/**
 * 要素だけ外して子を残すもの。保存側は許可リスト外の要素を原則 unwrap
 * する（散文を黙って消さないため）ので、面もそちらへ揃える — `form` を
 * 子ごと落とすと、`<form>` に包まれた領域を貼った WYSIWYG では面の DOM が
 * 本文の正本である以上、散文が恒久的に消えて次の保存でサーバーへ書き戻る。
 * `link` / `meta` / `base` は子を持てないので、どちらの扱いでも結果は
 * 同じである。
 */
const UNSAFE_UNWRAP_ELEMENTS = new Set(["form", "link", "meta", "base"]);

/**
 * URL を運ぶ属性と、それが [ADR 013](spec/adr/013-html-sanitization-policy.md)
 * の表のどちらの行に当たるか。ナビゲーション（クリックで移る先）は
 * `data:` を拒み、リソース（自動で取りに行く先）はラスタ画像の `data:`
 * だけを通す — 判定そのものは保存と共有の
 * `domain/note/services/urlPolicy.ts` が持つ。
 */
const URL_ATTRIBUTES: ReadonlyMap<string, "navigation" | "resource"> = new Map([
  ["href", "navigation"],
  ["xlink:href", "navigation"],
  ["cite", "navigation"],
  ["action", "navigation"],
  ["formaction", "navigation"],
  ["src", "resource"],
  ["poster", "resource"],
]);

const scrubForSurface = (root: ParentNode): void => {
  for (const element of Array.from(root.querySelectorAll("*"))) {
    if (UNSAFE_DROP_ELEMENTS.has(element.localName)) {
      element.remove();
      continue;
    }
    if (UNSAFE_UNWRAP_ELEMENTS.has(element.localName)) {
      element.replaceWith(...Array.from(element.childNodes));
      continue;
    }
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      if (name.startsWith("on")) {
        element.removeAttribute(attribute.name);
        continue;
      }
      // `srcset` は候補ごとに判定する。1 つ落ちただけで属性ごと捨てると、
      // 保存が残す候補を面が落とすことになる。
      if (name === "srcset") {
        const kept = filterAllowedSrcset(attribute.value);
        if (kept === null) element.removeAttribute(attribute.name);
        else if (kept !== attribute.value) {
          element.setAttribute(attribute.name, kept);
        }
        continue;
      }
      const kind = URL_ATTRIBUTES.get(name);
      if (kind !== undefined && !isAllowedUrl(attribute.value, kind)) {
        element.removeAttribute(attribute.name);
      }
    }
  }
};

/**
 * WYSIWYG の面だけが追加で落とすもの。`<style>` は保存時のサニタイズが
 * **意図して残す**要素（ED-03 の「スタイルシートは本文に埋め込みます」）
 * なので、これは `scrubForSurface` の部分集合の性質から外れる — 落とすと
 * 面の内容がそのまま保存の元値になる以上、装飾が実際に失われる。
 *
 * それでも落とすのは、この面が shadow root の外にあるためである。HTML の
 * `<style>` は挿入位置によらず**文書全体**に効くので、本文が持つ
 * セレクターが編集画面の上部バー・保存ボタン・警告にそのまま当たる。
 * 共有ワークスペースでは他のメンバーが書いた本文が自分の編集画面を
 * 壊せる。
 *
 * 失われることは ED-04 の門（装飾が失われうる警告と、保存前に残る版）が
 * 先に告げる。門の材料は {@link willDropStyleElements} で、断片を描いた
 * 時点の本文ではなく**これから面へ載る本文**に当てる。ここは `baseline`
 * が変わるたびに無条件で落とすので、門もモードを変える瞬間ではなく
 * **面へ本文を載せるたび**に問われる（モードを変えない載せ直しは版の復元・
 * 競合の解決・退避の復元の 3 つ。WYSIWYG / HTML モードの保存後は caret を
 * 飛ばさないために載せ直さないので、そこは門を通らない）。
 */
const dropStyleElements = (root: ParentNode): void => {
  for (const element of Array.from(root.querySelectorAll("style"))) {
    element.remove();
  }
};

/**
 * この本文を WYSIWYG の面へ載せると装飾が落ちるか（ED-04 の門の材料）。
 *
 * {@link dropStyleElements} と**同じ問い**を同じパーサーに投げる — 走査で
 * 近似すると、落とす側と門の側で答えがずれる。サーバーコンポーネント側
 * （`NoteEditor/index.tsx`）は `document` を持たないので走査で判定して
 * おり、そちらは取りこぼさない側へ倒してある。両者は or で使う。
 */
export const willDropStyleElements = (html: string): boolean => {
  const template = document.createElement("template");
  template.innerHTML = html;
  return template.content.querySelector("style") !== null;
};

type SourceAnalysis = Readonly<{
  /**
   * ブラウザーの HTML パーサーが直した結果。壊れた構文（閉じていない
   * タグ、入れ子の違反、省略された要素）はここで補われる。サーバー側の
   * `HtmlProcessor` とは別の実装だが、どちらも HTML の構文解析規則その
   * ものを実装しているので、補正の結果は一致する。`null` は「補正が要ら
   * なかった」で、警告を出さない。
   */
  repaired: string | null;
  preview: string;
}>;

/**
 * ソースとパーサーの読み戻しを比べて「構文を補正したか」を決める（ED-03
 * の「構文が壊れている場合」）。
 *
 * 比べるのは**要素と属性の名前の並び**（{@link sameMarkupStructure}）で、
 * 文字列そのものではない。`template.innerHTML` の読み戻しは正規化された
 * 直列化を返すので、文字列で比べると `<br/>`・大文字のタグ名・単引用符・
 * 引用符の無い属性値・エンティティ表記—どれも HTML5 として正しい書き方—が
 * すべて「補正」に化け、本当に壊れているときの警告がその中に埋もれる。
 * 名前の並びが動くのは閉じ忘れ・入れ子の違反・省略要素の補完のときだけ
 * なので、それだけを警告に出す。
 */
const analyzeMarkup = (source: string): SourceAnalysis => {
  const template = document.createElement("template");
  template.innerHTML = source;
  // 補正の判定は scrub の前に取る（scrub が落とした分を「構文の補正」と
  // して報せてしまわないため）。
  const parsed = template.innerHTML;
  scrubForSurface(template.content);
  return {
    repaired: sameMarkupStructure(source, parsed) ? null : parsed,
    preview: template.innerHTML,
  };
};

export function HtmlSurface({
  value,
  editable,
  onChange,
  textareaRef,
  onDropFiles,
}: {
  value: string;
  /** `WysiwygSurface` と同じ意味。`readOnly` を選ぶのは選択とコピーを残すため。 */
  editable: boolean;
  onChange: (html: string) => void;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  onDropFiles: ((files: readonly File[]) => void) | null;
}) {
  const sourceId = useId();
  const overlayRef = useRef<HTMLPreElement | null>(null);

  // 構文解析はブラウザーのパーサーに聞くので、描画のあとに走らせる
  // （サーバー側の描画には `document` が無い）。打鍵が止まってからにする
  // のは、書きかけのタグ（`<p` まで打った状態）がどれも「壊れている」に
  // 当たり、打つそばから警告が出入りするためである。開いた直後の 1 回
  // だけ待たないのは、待つとプレビューが空のまま始まるため。
  const [analysis, setAnalysis] = useState<SourceAnalysis>({
    repaired: null,
    preview: "",
  });
  const analyzedRef = useRef(false);
  useEffect(() => {
    const delay = analyzedRef.current ? REPAIR_CHECK_DELAY_MS : 0;
    analyzedRef.current = true;
    const timer = window.setTimeout(() => {
      setAnalysis(analyzeMarkup(value));
    }, delay);
    return () => window.clearTimeout(timer);
  }, [value]);
  const repaired = analysis.repaired;

  const tokens = useMemo(
    () => (value.length > HIGHLIGHT_MAX_LENGTH ? null : tokenizeHtml(value)),
    [value],
  );

  return (
    <div className="grid gap-4">
      <div className="overflow-hidden rounded-lg border border-hairline">
        <div className="border-b border-hairline bg-surface-elevated px-3 py-2 text-xs tracking-[0.06em] text-ink-tertiary uppercase">
          <label htmlFor={sourceId}>ソース</label>
        </div>
        {/* 色分けは背面の `pre` が描き、前面の `textarea` は文字を透明に
            して caret と選択だけを担う。`contenteditable` にすると打鍵の
            たびに caret が飛ぶので、入力そのものは素の `textarea` に
            残してある。字送りの規則は両者で共有する。 */}
        <div className="relative bg-bg">
          <pre
            ref={overlayRef}
            aria-hidden="true"
            className={`pointer-events-none absolute inset-0 m-0 overflow-hidden p-3 text-ink ${sourceTypeClass}`}
          >
            {tokens === null
              ? value
              : tokens.map((token, index) =>
                  token.kind === "text" ? (
                    // biome-ignore lint/suspicious/noArrayIndexKey: トークン列は毎回作り直す派生値で、並べ替えも部分更新も起きない。
                    <span key={index}>{token.text}</span>
                  ) : (
                    <span
                      // biome-ignore lint/suspicious/noArrayIndexKey: 同上。
                      key={index}
                      className={TOKEN_CLASS[token.kind]}
                    >
                      {token.text}
                    </span>
                  ),
                )}
            {"\n"}
          </pre>
          <textarea
            id={sourceId}
            ref={textareaRef}
            value={value}
            spellCheck={false}
            readOnly={!editable}
            onChange={(event) => onChange(event.target.value)}
            onScroll={(event) => {
              const overlay = overlayRef.current;
              if (overlay !== null) {
                overlay.scrollTop = event.currentTarget.scrollTop;
              }
            }}
            className={`relative block min-h-[220px] w-full resize-y bg-transparent p-3 text-transparent outline-none [caret-color:var(--color-ink)] ${sourceTypeClass}`}
            {...dropHandlers(onDropFiles)}
          />
        </div>
      </div>

      {/* ED-03「構文が壊れている場合、保存前に警告し、補正後の結果を
          プレビューで示す」。 */}
      {repaired === null ? null : (
        <Alert tone="warning" title="HTML の構文を補正しました" role="status">
          閉じていないタグや入れ子の誤りを補いました。下のプレビューは補正した構文で描いています。保存時にはさらに、許可されていない要素・属性・CSS
          宣言が取り除かれます（除去された分は保存後に一覧で示します）。
        </Alert>
      )}

      <div className="overflow-hidden rounded-lg border border-hairline">
        <div className="border-b border-hairline bg-surface-elevated px-3 py-2 text-xs tracking-[0.06em] text-ink-tertiary uppercase">
          {repaired === null ? "プレビュー" : "プレビュー（補正後）"}
        </div>
        {/* `contain` を掛けるのは、プレビューが落とすのが保存時のサニ
            タイズの部分集合（`on*`・許可外のスキームの URL・script 相当
            の要素）に限られるため。`position: fixed` は残るので、ここが
            固定配置の包含ブロックにならないと本文が編集画面全体を覆える。
            Shadow DOM が隔離するのはスタイルの適用範囲だけで、ビュー
            ポート基準の配置は隔離しない。 */}
        <div className="min-h-[220px] [contain:layout_paint] p-4 text-sm leading-relaxed">
          <NoteBody html={analysis.preview} styleMode="default" headings={[]} />
        </div>
      </div>
    </div>
  );
}

/**
 * ビジュアル（ED-02）。テキストノードだけを編集させ、要素の追加・削除・
 * 並べ替えを構造的に不可能にする — 各テキストノードを個別の編集ホスト
 * （`contenteditable="plaintext-only"` の `span`）に載せるので、編集の
 * 範囲がそのノードの中に閉じる。
 *
 * 経路は**元の DOM**（span を差し込む前）で数える。差し込んだあとの
 * `childNodes` で数えると、サーバー側の `HtmlProcessor` が見る木と
 * インデックスがずれて全件 `pathNotFound` に落ちる。
 */
export function VisualSurface({
  baseline,
  seed,
  editable,
  onReady,
  onChange,
}: {
  baseline: string;
  /**
   * 面を組み直す世代。`baseline` と別に要るのは、破棄がまさに**同じ
   * 文字列**へ戻す操作だからである — 文字列の同一性だけを鍵にすると、
   * 破棄しても span の中身が編集したまま残る。
   */
  seed: number;
  /** `WysiwygSurface` と同じ意味。 */
  editable: boolean;
  onReady: (paths: ReadonlyMap<string, string>) => void;
  onChange: (current: ReadonlyMap<string, string>) => void;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const onReadyRef = useRef(onReady);
  const onChangeRef = useRef(onChange);
  onReadyRef.current = onReady;
  onChangeRef.current = onChange;

  // biome-ignore lint/correctness/useExhaustiveDependencies: `seed` は値を読まず、再シードを起こすためだけに置いてある（`baseline` が同じ文字列へ戻る破棄を鍵にできない）。
  useEffect(() => {
    const host = hostRef.current;
    if (host === null) return;
    const root = host.shadowRoot ?? host.attachShadow({ mode: "open" });

    const template = document.createElement("template");
    template.innerHTML = baseline;
    const editable = collectEditableTextNodes(template.content);

    const original = new Map<string, string>();
    const spans: HTMLSpanElement[] = [];
    for (const entry of editable) {
      original.set(entry.path, entry.text);
      const span = document.createElement("span");
      span.setAttribute("data-hollow-path", entry.path);
      span.setAttribute("contenteditable", "plaintext-only");
      span.textContent = entry.text;
      entry.node.replaceWith(span);
      spans.push(span);
    }

    // 載せるのは scrub したあとの木。経路を数え終えてから通すのは、
    // 数える木がサーバー（`HtmlProcessor`）の見る木と 1 つでも違うと
    // 編集が全件 `pathNotFound` に落ちるためである。
    scrubForSurface(template.content);

    const style = document.createElement("style");
    style.textContent = `
:host { display: block; }
[data-hollow-path] { outline: none; caret-color: var(--color-accent); border-radius: 3px; }
[data-hollow-path]:focus { background: var(--color-surface); box-shadow: 0 0 0 2px var(--color-surface); }
img, video { max-width: 100%; height: auto; }
`;
    root.replaceChildren(style, template.content);

    const readAll = (): ReadonlyMap<string, string> =>
      new Map(
        spans.map((span) => [
          span.getAttribute("data-hollow-path") ?? "",
          span.textContent ?? "",
        ]),
      );

    const listener = () => onChangeRef.current(readAll());
    root.addEventListener("input", listener);
    onReadyRef.current(original);
    return () => root.removeEventListener("input", listener);
  }, [baseline, seed]);

  // 編集の可否は面を組み直さずに切り替える（組み直すと、ロックが掛かった
  // 瞬間に書きかけが消える）。上の effect と同じ commit で走るので、
  // 差し込んだ直後の span にも塗り直しの前に当たる。
  //
  // biome-ignore lint/correctness/useExhaustiveDependencies: `baseline` / `seed` は値を読まずに置いてある。上の effect が span を作り直すたびにここも走らないと、組み直した直後の面が `editable` を無視した状態で残る。
  useEffect(() => {
    const root = hostRef.current?.shadowRoot;
    if (root === null || root === undefined) return;
    for (const span of Array.from(
      root.querySelectorAll("[data-hollow-path]"),
    )) {
      span.setAttribute(
        "contenteditable",
        editable ? "plaintext-only" : "false",
      );
    }
  }, [editable, baseline, seed]);

  return (
    <>
      {/* ED-02 の制約は構造的に効いている（要素の追加・削除は操作として
          存在しない）が、何が起きないのかは面を見ても分からない。 */}
      <p className="mb-4 rounded-md bg-surface px-3 py-2 text-xs text-ink-secondary">
        ビジュアルモードでは本文のテキストの書き換えだけを行えます。段落や画像の追加・削除・並べ替えはできません（構造を変えるときは
        HTML か WYSIWYG モードに切り替えてください）。
      </p>
      {/* shadow tree の中の `:host { … !important }` はホスト要素に当たり、
          `!important` が付くと内側の木が外側に勝つ。ホストに掛けたクラス
          （`relative`）では `transform` / `width` / `margin` を止められない
          ので、閉じ込めは親側に置く（HTML のプレビューと同じ包み）。 */}
      <div className="[contain:layout_paint]">
        <div ref={hostRef} className="relative min-h-[46vh]" />
      </div>
    </>
  );
}
