import { createFileRoute } from "@tanstack/react-router";
import { Suspense } from "react";
import { Deferred } from "@/components/ui/Deferred";
import { ServerErrorState } from "@/components/ui/ErrorState";
import { WorkspaceMembersSkeleton } from "@/components/workspace/WorkspaceSettingsSkeleton";
import { buildHead } from "@/presentation/head";
import { renderWorkspaceMembersPanel } from "./-action";

/**
 * P-32 メンバー管理。認証ガードとタブ列は親の
 * `/workspaces/$workspaceId/settings` が持つ。一覧は fragment
 * ストリーミングで、loader は未解決の promise をそのまま転送する。
 */
export const Route = createFileRoute(
  "/workspaces/$workspaceId/settings/members",
)({
  // 無期限で持てるのは、鮮度を各ミューテーションの `router.invalidate()` が
  // 担うため。
  staleTime: import.meta.env.DEV ? 0 : Number.POSITIVE_INFINITY,
  loader: async ({ params }) => {
    const { WorkspaceMembersPanel } = await renderWorkspaceMembersPanel({
      data: { workspaceId: params.workspaceId },
    });
    return { WorkspaceMembersPanel };
  },
  head: ({ match }) => {
    const config = match.context?.config;
    if (!config) return {};
    const { meta, links } = buildHead(config, {
      title: `メンバー管理 — ${config.siteName}`,
      path: `/workspaces/${match.params.workspaceId}/settings/members`,
    });
    return { meta, links };
  },
  component: WorkspaceMembersPage,
  errorComponent: () => <ServerErrorState />,
});

function WorkspaceMembersPage() {
  const { WorkspaceMembersPanel } = Route.useLoaderData();
  return (
    <Suspense fallback={<WorkspaceMembersSkeleton />}>
      <Deferred promise={WorkspaceMembersPanel} />
    </Suspense>
  );
}
