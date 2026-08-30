import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

/**
 * P-11 の読むシェル: 上部バーは前の文脈へ戻る導線だけの最小形
 * （spec/pages/index.md#L-01 読む画面の変形）。パレットは未機能のため
 * トリガーごと出さない — 一覧側と違い、この画面はバーの要素が導線
 * 1 つでも成立する。
 *
 * 戻り先は文脈で変わる（個人 / ワークスペース）ので、`/notes` 以下と
 * `/workspaces/:workspaceId/notes` 以下の両ルートが同じシェルを使い、
 * 行き先だけを渡す。
 */
export function ReaderShell({
  workspaceId = null,
  children,
}: {
  workspaceId?: string | null;
  children: ReactNode;
}) {
  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-40 flex h-[var(--bar-height)] items-center gap-2 bg-[var(--bar-bg)] px-4 backdrop-blur-xl backdrop-saturate-150 sm:px-6">
        {workspaceId === null ? (
          <Link to="/notes" className={backLinkClass}>
            <BackIcon />
            <span className="truncate">ノート一覧</span>
          </Link>
        ) : (
          <Link
            to="/workspaces/$workspaceId/notes"
            params={{ workspaceId }}
            className={backLinkClass}
          >
            <BackIcon />
            <span className="truncate">ノート一覧</span>
          </Link>
        )}
      </header>
      {children}
    </div>
  );
}

const backLinkClass =
  "inline-flex h-8 min-w-0 items-center gap-1 rounded-md px-2 text-sm text-ink-secondary transition-colors hover:bg-surface hover:text-ink";

function BackIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="15 18 9 12 15 6" />
    </svg>
  );
}
