import { createFileRoute } from "@tanstack/react-router";
import { Suspense } from "react";
import { Deferred } from "@/components/ui/Deferred";
import { ServerErrorState } from "@/components/ui/ErrorState";
import { WorkspaceDangerSkeleton } from "@/components/workspace/WorkspaceSettingsSkeleton";
import { buildHead } from "@/presentation/head";
import { renderWorkspaceDangerPanel } from "./-action";

/**
 * P-34 ワークスペース削除。認証ガードとタブ列は親が持つ。確認入力に出す
 * ワークスペース名をサーバー側から取るので、断片ストリーミングで読む。
 */
export const Route = createFileRoute(
  "/workspaces/$workspaceId/settings/danger",
)({
  staleTime: import.meta.env.DEV ? 0 : Number.POSITIVE_INFINITY,
  loader: async ({ params }) => {
    const { WorkspaceDangerPanel } = await renderWorkspaceDangerPanel({
      data: { workspaceId: params.workspaceId },
    });
    return { WorkspaceDangerPanel };
  },
  head: ({ match }) => {
    const config = match.context?.config;
    if (!config) return {};
    const { meta, links } = buildHead(config, {
      title: `ワークスペースの削除 — ${config.siteName}`,
      path: `/workspaces/${match.params.workspaceId}/settings/danger`,
    });
    return { meta, links };
  },
  component: WorkspaceDangerPage,
  errorComponent: () => <ServerErrorState />,
});

function WorkspaceDangerPage() {
  const { WorkspaceDangerPanel } = Route.useLoaderData();
  return (
    <Suspense fallback={<WorkspaceDangerSkeleton />}>
      <Deferred promise={WorkspaceDangerPanel} />
    </Suspense>
  );
}
