"use client";

import {
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

export function WysiwygSurface({
  baseline,
  surfaceRef,
  onChange,
}: {
  /** 外から本文が差し替わったときだけ変わる値（復元・破棄・版の復元）。 */
  baseline: string;
  surfaceRef: RefObject<HTMLDivElement | null>;
  onChange: (html: string) => void;
}) {
  // 本文は React の子ではなくブラウザーが持つ（contenteditable の DOM を
  // React に再描画させると caret が飛ぶ）。差し替えは baseline が変わった
  // ときだけ行う。
  useEffect(() => {
    const surface = surfaceRef.current;
    if (surface === null) return;
    if (surface.innerHTML !== baseline) {
      surface.innerHTML = baseline;
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
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        tabIndex={0}
        aria-multiline="true"
        aria-label="本文"
        className={editorSurfaceClass}
        onInput={(event) => onChange(event.currentTarget.innerHTML)}
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

/**
 * ブラウザーの HTML パーサーが直した結果。壊れた構文（閉じていないタグ、
 * 引用符の無い属性値）はここで補われる。
 *
 * サーバー側の `HtmlProcessor` とは別の実装だが、どちらも HTML の構文解析
 * 規則そのものを実装しているので、補正の結果は一致する。`null` は「補正が
 * 要らなかった」で、警告もプレビューの差し替えも起こさない。
 */
const REPAIR_CHECK_DELAY_MS = 500;

function repairMarkup(source: string): string | null {
  const template = document.createElement("template");
  template.innerHTML = source;
  const repaired = template.innerHTML;
  return repaired === source ? null : repaired;
}

export function HtmlSurface({
  value,
  onChange,
  textareaRef,
}: {
  value: string;
  onChange: (html: string) => void;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
}) {
  const sourceId = useId();
  const overlayRef = useRef<HTMLPreElement | null>(null);

  // 構文の補正はブラウザーのパーサーに聞くので、描画のあとに走らせる
  // （サーバー側の描画には `document` が無い）。打鍵が止まってからにする
  // のは、書きかけのタグ（`<p` まで打った状態）がどれも「壊れている」に
  // 当たり、打つそばから警告が出入りするためである。
  const [repaired, setRepaired] = useState<string | null>(null);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setRepaired(repairMarkup(value));
    }, REPAIR_CHECK_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [value]);

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
            onChange={(event) => onChange(event.target.value)}
            onScroll={(event) => {
              const overlay = overlayRef.current;
              if (overlay !== null) {
                overlay.scrollTop = event.currentTarget.scrollTop;
              }
            }}
            className={`relative block min-h-[220px] w-full resize-y bg-transparent p-3 text-transparent outline-none [caret-color:var(--color-ink)] ${sourceTypeClass}`}
          />
        </div>
      </div>

      {/* ED-03「構文が壊れている場合、保存前に警告し、補正後の結果を
          プレビューで示す」。 */}
      {repaired === null ? null : (
        <Alert tone="warning" title="HTML の構文を補正しました" role="status">
          閉じていないタグや引用符の無い属性値を補いました。保存すると、下のプレビューの内容で保存されます。
        </Alert>
      )}

      <div className="overflow-hidden rounded-lg border border-hairline">
        <div className="border-b border-hairline bg-surface-elevated px-3 py-2 text-xs tracking-[0.06em] text-ink-tertiary uppercase">
          {repaired === null ? "プレビュー" : "プレビュー（補正後）"}
        </div>
        <div className="min-h-[220px] p-4 text-sm leading-relaxed">
          {/* プレビューは保存前の本文なのでサニタイズを通っていない。
              Shadow DOM の隔離は `NoteBody` と同じ扱いで、実際の安全は
              保存時のサニタイズと CSP が担う。 */}
          <NoteBody
            html={repaired ?? value}
            styleMode="default"
            headings={[]}
          />
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
  onReady,
  onChange,
}: {
  baseline: string;
  onReady: (paths: ReadonlyMap<string, string>) => void;
  onChange: (current: ReadonlyMap<string, string>) => void;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const onReadyRef = useRef(onReady);
  const onChangeRef = useRef(onChange);
  onReadyRef.current = onReady;
  onChangeRef.current = onChange;

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
  }, [baseline]);

  return <div ref={hostRef} className="relative min-h-[46vh]" />;
}
