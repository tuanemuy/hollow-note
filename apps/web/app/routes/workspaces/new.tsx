import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/layout/AppShell";
import { ServerErrorState } from "@/components/ui/ErrorState";
import { CreateWorkspaceForm } from "@/components/workspace/CreateWorkspaceForm";
import { buildHead } from "@/presentation/head";
import { boundedRedirectSource } from "@/presentation/redirect";
import { loadWorkspaceCreatePage } from "./-action";

/**
 * P-30 ワークスペース作成。ガードは loader が畳んで持つ（1 往復・1 脚）。
 * まだどのワークスペースの文脈にも入っていないので、シェルのスコープは
 * 個人のまま。
 */
export const Route = createFileRoute("/workspaces/new")({
  // loader がガードを兼ねるので毎ナビゲーション再実行させる。`staleTime`
  // は併記しない（`shouldReload` があると参照されない）。
  shouldReload: ({ cause }) => cause !== "preload",
  loader: ({ location }) =>
    loadWorkspaceCreatePage({
      data: { redirect: boundedRedirectSource(location.href) },
    }),
  head: ({ match }) => {
    const config = match.context?.config;
    if (!config) return {};
    const { meta, links } = buildHead(config, {
      title: `ワークスペースを作る — ${config.siteName}`,
      path: "/workspaces/new",
    });
    return { meta, links };
  },
  component: WorkspaceNewPage,
  errorComponent: () => <ServerErrorState />,
});

function WorkspaceNewPage() {
  const { user, appUrl } = Route.useLoaderData();
  return (
    <AppShell displayName={user.displayName} avatarUrl={user.avatarUrl}>
      <CreateWorkspaceForm slugPrefix={slugPrefix(appUrl)} />
    </AppShell>
  );
}

function slugPrefix(appUrl: string): string {
  try {
    return `${new URL(appUrl).host}/w/`;
  } catch {
    return "/w/";
  }
}
