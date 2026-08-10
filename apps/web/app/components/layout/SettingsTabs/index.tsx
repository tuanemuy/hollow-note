"use client";

import { useRouterState } from "@tanstack/react-router";

/**
 * P-20 設定タブ列（spec/pages/index.md#P-20、モック
 * P21-settings-profile.html）。L-01 中央カラム上部の水平タブで、常設
 * サイドバーの代わりに設定画面どうしを行き来する。`sm` 未満は横スクロール。
 *
 * 個人設定の 4 タブのみを出す。spec のタブ列にある「連携」は遷移先 P-23
 * が別スライスのため置かない（無効タブの placeholder も作らない）。
 * ワークスペース設定のタブ列も別スライス。
 */
export const SETTINGS_TABS = [
  { href: "/settings/profile", label: "プロフィール" },
  { href: "/settings/auth", label: "ログイン方法" },
  { href: "/settings/usage", label: "使用量" },
  { href: "/settings/danger", label: "アカウント削除" },
] as const;

export function SettingsTabs() {
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });

  return (
    <nav
      aria-label="設定"
      className="mb-8 flex gap-1 overflow-x-auto border-b border-hairline [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {SETTINGS_TABS.map((tab) => {
        const current = pathname === tab.href;
        return (
          // 通常のリンク（`Link` ではない）: 遷移先のルートを追加するのは
          // 各設定画面のスライスで、型付き `to` はそのルートが生成された
          // 後にしか書けない。画面が揃った時点で `Link` へ差し替える。
          <a
            key={tab.href}
            href={tab.href}
            aria-current={current ? "page" : undefined}
            className={`relative shrink-0 px-3 py-3 text-sm whitespace-nowrap transition-colors hover:text-ink ${
              current
                ? "font-medium text-ink after:absolute after:inset-x-2 after:-bottom-px after:h-0.5 after:bg-ink after:content-['']"
                : "text-ink-secondary"
            }`}
          >
            {tab.label}
          </a>
        );
      })}
    </nav>
  );
}
