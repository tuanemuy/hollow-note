import { createFileRoute, Outlet } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { WorkspaceSettingsTabs } from "@/components/layout/WorkspaceSettingsTabs";
import { ServerErrorState } from "@/components/ui/ErrorState";
import { WorkspaceUnavailableState } from "@/components/workspace/WorkspaceUnavailable";
import { extractSerializedError } from "@/presentation/errorResponse";
import { buildHead } from "@/presentation/head";
import { boundedRedirectSource } from "@/presentation/redirect";
import { loadWorkspaceSettingsShell } from "./-action";

/**
 * ワークスペース設定のレイアウト（L-01 + ワークスペース設定のタブ列）。
 * 個々の設定画面は子ルートで、シェル・タブ列・認証ガードをここに集約する。
 *
 * ガードを `beforeLoad` ではなく `loader` に置くのは、子ルートの断片
 * loader と並列に走らせるため。この match は子ルート間の遷移では
 * `cause: "stay"` のまま生き残るので、毎ナビゲーションの再判定は
 * `shouldReload` が担う。オブジェクト形 + `staleReloadMode: "blocking"` に
 * するのは、再実行がデタッチされた背景枝へ落ちるとタブ列にホバーしただけで
 * `/signin` へ実ナビゲートしてしまうため（`/settings` と同じ理由）。
 */
export const Route = createFileRoute("/workspaces/$workspaceId/settings")({
  shouldReload: ({ cause }) => cause !== "preload",
  loader: {
    staleReloadMode: "blocking",
    handler: ({ params, location }) =>
      loadWorkspaceSettingsShell({
        data: {
          workspaceId: params.workspaceId,
          redirect: boundedRedirectSource(location.href),
        },
      }),
  },
  head: ({ match }) => {
    const config = match.context?.config;
    if (!config) return {};
    const { meta, links } = buildHead(config, {
      title: `ワークスペース設定 — ${config.siteName}`,
      path: `/workspaces/${match.params.workspaceId}/settings`,
    });
    return { meta, links };
  },
  component: WorkspaceSettingsLayout,
  // 削除済み・存在しないワークスペースは `WORKSPACE_NOT_FOUND` で来る。
  // 非メンバーと同じ表示に畳む（存在の有無を漏らさない）。
  errorComponent: ({ error }) =>
    extractSerializedError(error).kind === "notFound" ? (
      <WorkspaceUnavailableState />
    ) : (
      <ServerErrorState />
    ),
});

function WorkspaceSettingsLayout() {
  const { user, workspace } = Route.useLoaderData();

  if (workspace === null) {
    return (
      <AppShell displayName={user.displayName} avatarUrl={user.avatarUrl}>
        <WorkspaceUnavailableState />
      </AppShell>
    );
  }

  return (
    <AppShell
      displayName={user.displayName}
      avatarUrl={user.avatarUrl}
      scope={{
        kind: "workspace",
        workspaceId: workspace.workspaceId,
        name: workspace.name,
        slug: workspace.slug,
        publication: workspace.publication,
      }}
    >
      <SettingsColumn>
        <h1 className="mb-5 flex items-center gap-3 text-3xl font-light tracking-tightest leading-tight">
          <span
            aria-hidden="true"
            className="inline-flex size-7 shrink-0 items-center justify-center rounded-md bg-ink text-xs font-medium text-bg"
          >
            {workspace.name.trim().slice(0, 2) || "?"}
          </span>
          <span className="min-w-0 truncate">{workspace.name}</span>
        </h1>
        <WorkspaceSettingsTabs workspaceId={workspace.workspaceId} />
      </SettingsColumn>
    </AppShell>
  );
}

function SettingsColumn({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto max-w-[var(--list-max)] px-4 pt-8 pb-20 sm:px-6 sm:pt-10 lg:pt-12">
      {children}
      <Outlet />
    </main>
  );
}
