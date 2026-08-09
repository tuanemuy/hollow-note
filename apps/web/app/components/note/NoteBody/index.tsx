"use client";

import type { NoteHeadingView } from "@repo/core/application/note/view";
import type React from "react";
import { useEffect, useRef } from "react";

/**
 * P-11 の本文描画。本文 HTML は Shadow DOM に隔離する（ADR 007 /
 * spec/presentation/index.md#Declarative-Shadow-DOM-に関する注意）。
 *
 * マークアップは `<template shadowrootmode="open">` で出す — サーバー
 * 描画の HTML をブラウザーがパースする経路では宣言的に shadow root に
 * なる。一方 RSC ストリーミング後のクライアント描画（Flight payload →
 * DOM API）は宣言的 Shadow DOM を解釈しないため、effect が残った
 * template を `attachShadow` に昇格させる（ADR-023）。
 *
 * ホストは絶対配置の包含ブロック（relative）にする — 本文の
 * `position: absolute` の基準を本文の内側に閉じるのは描画側の責務。
 * Shadow DOM が隔離するのはスタイルであって権限ではない: 本文の安全は
 * サニタイズ（後続スライス）と CSP が担い、本スライスで届く本文は
 * 白紙由来のみ。
 */

// styleMode "default" の既定スタイル。GitHub 構造 × Apple Calm
// （spec/design/pages/P11-note.html の .content を shadow 内へ写した最小集合）。
const DEFAULT_CONTENT_CSS = `
:host { display: block; font-size: var(--text-base); line-height: var(--leading-relaxed); color: var(--color-ink); }
h1 { font-size: var(--text-2xl); font-weight: 600; letter-spacing: var(--tracking-tighter); line-height: var(--leading-snug); margin: var(--space-10) 0 var(--space-4); }
h2 { font-size: var(--text-xl); font-weight: 600; letter-spacing: var(--tracking-tighter); line-height: var(--leading-snug); margin: var(--space-10) 0 var(--space-4); }
h3 { font-size: var(--text-lg); font-weight: 600; letter-spacing: var(--tracking-tight); margin: var(--space-8) 0 var(--space-3); }
p { margin: 0 0 var(--space-5); }
ul { list-style: disc; padding-left: 1.4em; margin: 0 0 var(--space-5); }
ol { list-style: decimal; padding-left: 1.4em; margin: 0 0 var(--space-5); }
li { margin-bottom: var(--space-2); }
a { color: var(--color-accent); }
a:hover { text-decoration: underline; text-underline-offset: 3px; }
code { font-family: var(--font-mono); font-size: var(--text-mono); background: var(--color-surface); padding: 2px 5px; border-radius: var(--radius-xs); }
pre { font-family: var(--font-mono); font-size: var(--text-mono); background: var(--color-surface); border-radius: var(--radius-lg); padding: var(--space-4); overflow-x: auto; margin: 0 0 var(--space-5); line-height: 1.6; }
pre code { background: none; padding: 0; }
blockquote { border-left: 3px solid var(--color-hairline-strong); padding-left: var(--space-4); color: var(--color-ink-secondary); margin: 0 0 var(--space-5); }
table { border-collapse: collapse; width: 100%; margin: 0 0 var(--space-5); font-size: var(--text-sm); }
th, td { border: 1px solid var(--color-hairline); padding: var(--space-2) var(--space-3); text-align: left; }
img, video { max-width: 100%; height: auto; border-radius: var(--radius-lg); }
hr { border: none; border-top: 1px solid var(--color-hairline); margin: var(--space-8) 0; }
`;

const MINIMAL_CONTENT_CSS = ":host { display: block; }";

// React's types don't know `shadowrootmode` yet; the lowercase attribute
// passes through to the HTML parser unchanged.
function shadowTemplateProps(html: string) {
  return {
    shadowrootmode: "open",
    dangerouslySetInnerHTML: { __html: html },
  } as unknown as React.ComponentProps<"template">;
}

export function NoteBody({
  html,
  styleMode,
  headings,
}: {
  html: string;
  styleMode: "default" | "preserve";
  headings: readonly NoteHeadingView[];
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);

  const css =
    styleMode === "default" ? DEFAULT_CONTENT_CSS : MINIMAL_CONTENT_CSS;
  const shadowHtml = `<style>${css}</style>${html}`;

  useEffect(() => {
    const host = hostRef.current;
    if (host === null) return;
    const template = host.querySelector("template[shadowrootmode]");
    if (host.shadowRoot === null && template instanceof HTMLTemplateElement) {
      // Client-inserted markup: promote the inert template to a real
      // shadow root (declarative parsing only happens in the HTML parser).
      host
        .attachShadow({ mode: "open" })
        .appendChild(template.content.cloneNode(true));
      template.remove();
    } else if (host.shadowRoot !== null) {
      // Re-render with new content (e.g. router invalidation).
      host.shadowRoot.innerHTML = shadowHtml;
      template?.remove();
    }
  }, [shadowHtml]);

  const scrollToHeading = (anchorId: string) => {
    hostRef.current?.shadowRoot
      ?.getElementById(anchorId)
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <>
      {headings.length > 0 ? (
        <details className="group border-t border-hairline">
          <summary className="flex cursor-pointer list-none items-center gap-2 py-4 text-sm text-ink-secondary transition-colors hover:text-ink [&::-webkit-details-marker]:hidden">
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
              className="shrink-0 text-ink-tertiary transition-transform group-open:rotate-90"
            >
              <polyline points="9 18 15 12 9 6" />
            </svg>
            見出し {headings.length} 件
          </summary>
          <ul className="pb-4">
            {headings.map((heading) => (
              <li key={heading.anchorId}>
                <button
                  type="button"
                  onClick={() => scrollToHeading(heading.anchorId)}
                  className="block w-full truncate rounded-md px-2 py-1.5 text-left text-sm text-ink-secondary transition-colors hover:bg-surface hover:text-ink"
                  style={{
                    paddingLeft: `${(Math.min(Math.max(heading.level, 1), 6) - 1) * 12 + 8}px`,
                  }}
                >
                  {heading.text}
                </button>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      <div ref={hostRef} className="relative">
        <template {...shadowTemplateProps(shadowHtml)} />
      </div>
    </>
  );
}
