"use client";

import { Link, useRouterState } from "@tanstack/react-router";

/**
 * ワークスペース設定のタブ列（spec/pages/index.md「設定は個人設定と
 * ワークスペース設定に分かれ、どちらも P-20 の設定タブを共有する。
 * **タブ列は個人とワークスペースで別々に持つ**」）。見た目は
 * `components/layout/SettingsTabs` と揃える。
 *
 * 「メンバー」（P-32）は遷移先が別スライスなので、その画面が入るまで
 * ここには並べない（無効タブの placeholder も作らない）。
 */
const TABS = [
  { to: "/workspaces/$workspaceId/settings/general", label: "一般" },
  { to: "/workspaces/$workspaceId/settings/publish", label: "公開" },
  { to: "/workspaces/$workspaceId/settings/danger", label: "削除" },
] as const;

export function WorkspaceSettingsTabs({
  workspaceId,
}: {
  workspaceId: string;
}) {
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });

  return (
    <nav
      aria-label="ワークスペース設定"
      className="mb-8 flex gap-1 overflow-x-auto border-b border-hairline [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {TABS.map((tab) => {
        const href = tab.to.replace("$workspaceId", workspaceId);
        const current = pathname === href;
        const className = `relative shrink-0 px-3 py-3 text-sm whitespace-nowrap transition-colors hover:text-ink ${
          current
            ? "font-medium text-ink after:absolute after:inset-x-2 after:-bottom-px after:h-0.5 after:bg-ink after:content-['']"
            : "text-ink-secondary"
        }`;
        return (
          <Link
            key={tab.to}
            to={tab.to}
            params={{ workspaceId }}
            aria-current={current ? "page" : undefined}
            className={className}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
