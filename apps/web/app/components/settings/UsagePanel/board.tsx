"use client";

import type { WorkspaceUsageView } from "@repo/core/application/usage/view";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState, useTransition } from "react";
import { displayError } from "@/presentation/errorDisplay";
import { loadMoreWorkspaceUsageFn } from "./action";
import { formatBytes, ratioOf, ScopeBadge, UsageSection } from "./section";

/**
 * P-24 のワークスペース別使用量（PAGE-p24-001 / PAGE-p24-002）。
 *
 * 先頭ページはサーバーコンポーネントが渡し、以降の継ぎ足しはこの島が
 * 所有する。追加読み込みはミューテーションではないので楽観的更新は要らず、
 * `useTransition` の pending 表示がボタン上で三層目を担う。
 *
 * 一覧が空でも `cursor` が残ることがある — `getUsageSnapshot` は
 * ページを引いたあとで owner / editor に絞るため、1 ページ全部が viewer
 * だと 0 件のままカーソルだけが進む。だからボタンの有無は件数ではなく
 * カーソルだけで決める。
 */
const UNNAMED_WORKSPACE = "名前を取得できないワークスペース";

const initials = (name: string): string => name.trim().slice(0, 2) || "?";

export function WorkspaceUsageBoard({
  initialWorkspaces,
  initialCursor,
}: {
  initialWorkspaces: readonly WorkspaceUsageView[];
  initialCursor: string | null;
}) {
  const loadMore = useServerFn(loadMoreWorkspaceUsageFn);
  // 先頭ページはサーバーコンポーネントが渡し、継ぎ足しだけをこの島が持つ。
  // サーバーが先頭ページを配り直したら継ぎ足しは古い集合を指すので捨てる
  // （`WorkspaceMembersPanel/board.tsx:useLoadedPages` と同じ形）。
  const [seed, setSeed] = useState(initialWorkspaces);
  const [extra, setExtra] = useState<readonly WorkspaceUsageView[]>([]);
  const [cursor, setCursor] = useState(initialCursor);
  const [isLoading, startLoading] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (seed !== initialWorkspaces) {
    setSeed(initialWorkspaces);
    setExtra([]);
    setCursor(initialCursor);
  }

  const workspaces =
    extra.length === 0 ? initialWorkspaces : [...initialWorkspaces, ...extra];

  const onLoadMore = (next: string) => {
    startLoading(async () => {
      let page: Awaited<ReturnType<typeof loadMore>>;
      try {
        page = await loadMore({ data: { cursor: next } });
      } catch (failure) {
        setError(displayError(failure));
        return;
      }
      setError(null);
      setExtra((current) => [...current, ...page.workspaces]);
      setCursor(page.nextWorkspaceCursor);
    });
  };

  return (
    <>
      {workspaces.map((workspace) =>
        workspace.state === "available" ? (
          <UsageSection
            key={workspace.workspaceId}
            name={
              <>
                <ScopeBadge>{initials(workspace.workspaceName)}</ScopeBadge>
                {workspace.workspaceName}
              </>
            }
            figure={`${formatBytes(workspace.consumedBytes)} / ${formatBytes(workspace.limitBytes)}`}
            level={workspace.level}
            ratio={ratioOf(workspace.consumedBytes, workspace.limitBytes)}
            notes={[
              ...(workspace.level === "exceeded"
                ? [
                    <span key="exceeded" className="text-error">
                      上限に達しています。新しいアップロードは受け付けられません
                    </span>,
                  ]
                : []),
              `${workspace.noteCount} 件のノート`,
              // PAGE-p24-003 の workspace 側。行が名指ししているワークスペース
              // をそのまま P-34 の文脈にする。
              <Link
                key="danger"
                to="/workspaces/$workspaceId/settings/danger"
                params={{ workspaceId: workspace.workspaceId }}
                className="text-ink underline underline-offset-2"
              >
                ワークスペース削除へ
              </Link>,
            ]}
          />
        ) : (
          <UnavailableRow
            key={workspace.workspaceId}
            name={workspace.workspaceName}
          />
        ),
      )}
      {cursor !== null ? (
        <button
          type="button"
          disabled={isLoading}
          aria-busy={isLoading}
          onClick={() => onLoadMore(cursor)}
          className="mt-2 block w-full rounded-md border border-hairline px-4 py-2.5 text-sm text-ink-secondary transition-colors hover:bg-surface hover:text-ink disabled:opacity-55"
        >
          {isLoading ? "読み込み中..." : "ワークスペースをさらに読み込む"}
        </button>
      ) : null}
      <p className="text-xs text-error not-empty:mt-2" role="status">
        {error}
      </p>
    </>
  );
}

/**
 * 一時的に読めないだけの行を落とすと「除名された」ように読めるので、
 * 並べたまま数値だけを落とす。名前が `null` なのは global directory の
 * シャードも答えられなかったときで、その場合だけ既定の文言に置き換える
 * （ID をそのまま出しても閲覧者には意味が無い）。
 */
function UnavailableRow({ name }: { name: string | null }) {
  return (
    <section className="border-t border-hairline py-5">
      <div className="mb-2 flex flex-wrap items-baseline gap-3">
        <span className="inline-flex items-center gap-2 text-sm font-medium">
          <ScopeBadge>{name === null ? "?" : initials(name)}</ScopeBadge>
          <span className={name === null ? "text-ink-tertiary" : undefined}>
            {name ?? UNNAMED_WORKSPACE}
          </span>
        </span>
      </div>
      <p
        className="flex items-center gap-2 text-xs text-ink-tertiary"
        role="status"
      >
        <svg
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          aria-hidden="true"
          className="shrink-0"
        >
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="13" />
          <line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
        使用量を取得できませんでした。ほかの表示には影響しません
      </p>
    </section>
  );
}
