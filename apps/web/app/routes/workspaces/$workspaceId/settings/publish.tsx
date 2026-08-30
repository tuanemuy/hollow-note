import { createFileRoute } from "@tanstack/react-router";
import { Suspense } from "react";
import { Deferred } from "@/components/ui/Deferred";
import { ServerErrorState } from "@/components/ui/ErrorState";
import { WorkspacePublishSkeleton } from "@/components/workspace/WorkspaceSettingsSkeleton";
import { buildHead } from "@/presentation/head";
import { renderWorkspacePublishPanel } from "./-action";

/**
 * P-33 ワークスペース公開設定。認証ガードとタブ列は親が持つ。
 */
export const Route = createFileRoute(
  "/workspaces/$workspaceId/settings/publish",
)({
  staleTime: import.meta.env.DEV ? 0 : Number.POSITIVE_INFINITY,
  loader: async ({ params }) => {
    const { WorkspacePublishPanel } = await renderWorkspacePublishPanel({
      data: { workspaceId: params.workspaceId },
    });
    return { WorkspacePublishPanel };
  },
  head: ({ match }) => {
    const config = match.context?.config;
    if (!config) return {};
    const { meta, links } = buildHead(config, {
      title: `ワークスペースの公開設定 — ${config.siteName}`,
      path: `/workspaces/${match.params.workspaceId}/settings/publish`,
    });
    return { meta, links };
  },
  component: WorkspacePublishPage,
  errorComponent: () => <ServerErrorState />,
});

function WorkspacePublishPage() {
  const { WorkspacePublishPanel } = Route.useLoaderData();
  return (
    <Suspense fallback={<WorkspacePublishSkeleton />}>
      <Deferred promise={WorkspacePublishPanel} />
    </Suspense>
  );
}
