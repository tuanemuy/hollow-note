import type { ReactNode } from "react";
import { AccountMenu } from "@/components/layout/AccountMenu";
import {
  PERSONAL_SHELL_SCOPE,
  ScopeToken,
  type ShellScope,
} from "@/components/layout/ScopeToken";
import { BrandMark } from "@/components/ui/BrandMark";

/**
 * L-01 アプリシェル（spec/pages/index.md#L-01）。上部バーに
 * マーク・スコープトークン・パレットトリガー（未機能のため disabled で
 * 置く）・アカウントメニューを載せる。アップロード・ティッカーは対応機能が
 * 本スライス外。
 *
 * スコープは各ルートが渡す — 文脈の正本は URL なので、シェルが自分で
 * 決めることはしない。既定は個人で、`/notes` や `/settings/*` のように
 * 文脈を持たない画面はそのまま使う。
 */
export function AppShell({
  displayName,
  avatarUrl = null,
  scope = PERSONAL_SHELL_SCOPE,
  children,
}: {
  displayName: string;
  avatarUrl?: string | null;
  scope?: ShellScope;
  children: ReactNode;
}) {
  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-40 flex h-[var(--bar-height)] items-center gap-2 bg-[var(--bar-bg)] px-4 backdrop-blur-xl backdrop-saturate-150 sm:px-6">
        <BrandMark className="shrink-0 text-ink" />
        <ScopeToken scope={scope} />
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
