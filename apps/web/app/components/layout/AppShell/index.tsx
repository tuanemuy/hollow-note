import type { ReactNode } from "react";
import { AccountMenu } from "@/components/layout/AccountMenu";
import { BrandMark } from "@/components/ui/BrandMark";

/**
 * L-01 アプリシェル（最小形、spec/pages/index.md#L-01）。上部バーに
 * マーク・スコープトークン（本スライスは個人固定）・パレットトリガー
 * （未機能のため disabled で置く）・アカウントメニューを載せる。
 * アップロード・ティッカーは対応機能が本スライス外。
 */
export function AppShell({
  displayName,
  avatarUrl = null,
  children,
}: {
  displayName: string;
  avatarUrl?: string | null;
  children: ReactNode;
}) {
  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-40 flex h-[var(--bar-height)] items-center gap-2 bg-[var(--bar-bg)] px-4 backdrop-blur-xl backdrop-saturate-150 sm:px-6">
        <BrandMark className="shrink-0 text-ink" />
        <span className="inline-flex h-[30px] max-w-[46vw] min-w-0 items-center gap-1 rounded-pill bg-surface pr-2 pl-[5px] text-sm">
          <span className="sr-only">現在のスコープ:</span>
          <span
            aria-hidden="true"
            className="inline-flex size-5 shrink-0 items-center justify-center rounded-sm bg-ink-secondary text-[9px] font-medium text-bg"
          >
            個
          </span>
          <span className="truncate">個人</span>
        </span>
        <div className="min-w-2 flex-1" />
        <button
          type="button"
          disabled
          aria-label="検索・操作（準備中）"
          className="inline-flex h-[30px] items-center gap-2 rounded-md border border-hairline px-2 text-sm text-ink-tertiary opacity-55 sm:w-60"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <circle cx="11" cy="11" r="7" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <span className="hidden flex-1 text-left sm:inline">検索・操作</span>
          <span
            aria-hidden="true"
            className="rounded-xs border border-hairline px-1 py-px font-mono text-[10px] leading-[1.4] text-ink-tertiary sm:ml-auto"
          >
            ⌘K
          </span>
        </button>
        <AccountMenu displayName={displayName} avatarUrl={avatarUrl} />
      </header>
      {children}
    </div>
  );
}
