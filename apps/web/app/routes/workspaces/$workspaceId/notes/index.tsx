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
import { renderWorkspaceNoteList } from "../-action";

/**
 * P-10 のワークスペース文脈版（`/workspaces/:workspaceId/notes`、WS-02 手順
 * 3 の切替先）。個人の `/notes` と同じ画面で、文脈だけが URL から来る。
 *
 * `shouldReload` / `loader` ガードの扱いは `/notes` と同じ理由による。
 */
export const Route = createFileRoute("/workspaces/$workspaceId/notes/")({
  shouldReload: ({ cause }) => cause !== "preload",
  loader: ({ params, location }) =>
    renderWorkspaceNoteList({
      data: {
        workspaceId: params.workspaceId,
        redirect: boundedRedirectSource(location.href),
      },
    }),
  head: ({ match }) => {
    const config = match.context?.config;
    if (!config) return {};
    const { meta, links } = buildHead(config, {
      title: `ノート一覧 — ${config.siteName}`,
      path: `/workspaces/${match.params.workspaceId}/notes`,
    });
    return { meta, links };
  },
  component: WorkspaceNotesPage,
  // 非メンバーと削除済み・不在を 1 つの表示に畳む（存在の有無を漏らさない）。
  // 判定は `workspaceUnavailability` に委ねる — 同じ失敗で loader が引き継ぎ
  // Cookie を畳んでいるので、ここが独自の写像を持つと画面と Cookie が同じ
  // 入力で違う結論を出す。`loader` が失敗している以上シェルに渡す利用者が
  // 無いので、上部バーが戻り先だけの最小形（`ReaderShell`、スコープは個人）で
  // 包む — 素のページに落とさず、次の行き先を必ず 1 つ残すため
  // （`notes/$noteId` と同じ理由）。
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

function WorkspaceNotesPage() {
  const { user, workspace, NoteList } = Route.useLoaderData();
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
      <Suspense fallback={<NoteListSkeleton />}>
        <Deferred promise={NoteList} />
      </Suspense>
    </AppShell>
  );
}
