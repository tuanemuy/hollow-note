import { createFileRoute } from "@tanstack/react-router";
import { Suspense } from "react";
import { Deferred } from "@/components/ui/Deferred";
import { ServerErrorState } from "@/components/ui/ErrorState";
import { WorkspaceGeneralSkeleton } from "@/components/workspace/WorkspaceSettingsSkeleton";
import { buildHead } from "@/presentation/head";
import { renderWorkspaceGeneralForm } from "./-action";

/**
 * P-31 ワークスペース一般設定。認証ガードとタブ列は親の
 * `/workspaces/$workspaceId/settings` が持つ。フォームは fragment
 * ストリーミングで、loader は未解決の promise をそのまま転送する。
 */
export const Route = createFileRoute(
  "/workspaces/$workspaceId/settings/general",
)({
  // 無期限で持てるのは、鮮度を各ミューテーションの `router.invalidate()` が
  // 担うため。
  staleTime: import.meta.env.DEV ? 0 : Number.POSITIVE_INFINITY,
  loader: async ({ params }) => {
    const { WorkspaceGeneralForm } = await renderWorkspaceGeneralForm({
      data: { workspaceId: params.workspaceId },
    });
    return { WorkspaceGeneralForm };
  },
  head: ({ match }) => {
    const config = match.context?.config;
    if (!config) return {};
    const { meta, links } = buildHead(config, {
      title: `ワークスペースの一般設定 — ${config.siteName}`,
      path: `/workspaces/${match.params.workspaceId}/settings/general`,
    });
    return { meta, links };
  },
  component: WorkspaceGeneralPage,
  errorComponent: () => <ServerErrorState />,
});

function WorkspaceGeneralPage() {
  const { WorkspaceGeneralForm } = Route.useLoaderData();
  return (
    <Suspense fallback={<WorkspaceGeneralSkeleton />}>
      <Deferred promise={WorkspaceGeneralForm} />
    </Suspense>
  );
}
