import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { BrandMark } from "@/components/ui/BrandMark";

/**
 * L-02 公開レイアウト（最小形）。文脈を持たないため、スコープトークンも
 * パレットも持たない（spec/pages/index.md#L-02）。公開検索は本スライス外
 * のため導線を出さない。
 */
type PublicShellProps = {
  children: ReactNode;
};

export function PublicShell({ children }: PublicShellProps) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex h-[var(--bar-height)] items-center gap-2 px-4 sm:px-6">
        <Link
          to="/"
          className="inline-flex items-center gap-2 text-ink"
          aria-label="Hollow のトップへ"
        >
          <BrandMark />
          <span className="text-sm font-medium">hollow</span>
        </Link>
        <div className="min-w-2 flex-1" />
        <Link
          to="/signin"
          className="inline-flex h-8 items-center rounded-md px-3 text-sm text-ink-secondary transition-colors hover:bg-surface hover:text-ink"
        >
          サインイン
        </Link>
        <Link
          to="/signup"
          className="inline-flex h-8 items-center rounded-pill bg-accent px-4 text-sm font-medium text-bg transition-colors hover:bg-accent-hover"
        >
          はじめる
        </Link>
      </header>
      <div className="flex-1">{children}</div>
      <footer className="border-t border-hairline">
        <div className="mx-auto flex max-w-[var(--list-max)] flex-wrap items-center gap-4 px-4 py-6 text-xs text-ink-secondary sm:px-6">
          <span>Hollow</span>
          <span className="flex-1" />
          <Link to="/terms" className="hover:text-ink hover:underline">
            利用規約
          </Link>
          <Link to="/privacy" className="hover:text-ink hover:underline">
            プライバシーポリシー
          </Link>
        </div>
      </footer>
    </div>
  );
}
