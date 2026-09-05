import { createFileRoute } from "@tanstack/react-router";
import { Suspense } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { ReaderShell } from "@/components/layout/ReaderShell";
import { NoteListSkeleton } from "@/components/note/NoteListSkeleton";
import { Deferred } from "@/components/ui/Deferred";
import { ServerErrorState } from "@/components/ui/ErrorState";
import { WorkspaceUnavailableState } from "@/components/workspace/WorkspaceUnavailable";
import { extractSerializedError } from "@/presentation/errorResponse";
import { buildHead } from "@/presentation/head";
import { boundedRedirectSource } from "@/presentation/redirect";
import { workspaceUnavailability } from "@/presentation/scope";
import { renderWorkspaceTrashList } from "../-action";

/**
 * P-14 のワークスペース文脈版（`/workspaces/:workspaceId/notes/trash`）。
 * 個人の `/notes/trash` と同じ画面で、文脈だけが URL から来る。
 *
 * 一覧（`notes/index.tsx`）と同じくワークスペース自身を読むので、
 * 非メンバー・削除済みの畳み方も同じにする — 同じ失敗で loader が
 * 引き継ぎ Cookie を畳んでいるため、ここが独自の写像を持つと画面と
 * Cookie が同じ入力で違う結論を出す。
 */
export const Route = createFileRoute("/workspaces/$workspaceId/notes/trash")({
  shouldReload: ({ cause }) => cause !== "preload",
  loader: ({ params, location }) =>
    renderWorkspaceTrashList({
      data: {
        workspaceId: params.workspaceId,
        redirect: boundedRedirectSource(location.href),
      },
    }),
  head: ({ match }) => {
    const config = match.context?.config;
    if (!config) return {};
    const { meta, links } = buildHead(config, {
      title: `ゴミ箱 — ${config.siteName}`,
      path: `/workspaces/${match.params.workspaceId}/notes/trash`,
    });
    return { meta, links };
  },
  component: WorkspaceTrashPage,
  errorComponent: ({ error }) => (
    <ReaderShell>
      {workspaceUnavailability(extractSerializedError(error)) === null ? (
        <ServerErrorState />
      ) : (
        <WorkspaceUnavailableState />
      )}
    </ReaderShell>
  ),
});

function WorkspaceTrashPage() {
  const { user, workspace, TrashList } = Route.useLoaderData();
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
        canWrite: workspace.canWrite,
      }}
    >
      <Suspense fallback={<NoteListSkeleton />}>
        <Deferred promise={TrashList} />
      </Suspense>
    </AppShell>
  );
}
