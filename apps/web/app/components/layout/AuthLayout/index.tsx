import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { BrandMark } from "@/components/ui/BrandMark";

/**
 * L-03 認証レイアウト。マークのみの最小バー + 中央 1 カラム
 * （spec/pages/index.md#L-03）。フッターは持たない。
 */
export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh">
      <header className="flex h-[var(--bar-height)] items-center justify-center">
        <Link to="/" aria-label="Hollow のトップへ" className="text-ink">
          <BrandMark width={30} height={18} />
        </Link>
      </header>
      <main className="mx-auto max-w-[400px] px-4 pt-8 pb-16 sm:px-6 sm:pt-12 lg:pt-16">
        {children}
      </main>
    </div>
  );
}
