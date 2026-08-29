import { createFileRoute } from "@tanstack/react-router";
import { Suspense } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { NoteListSkeleton } from "@/components/note/NoteListSkeleton";
import { Deferred } from "@/components/ui/Deferred";
import {
  ErrorState,
  ErrorStateLink,
  ServerErrorState,
} from "@/components/ui/ErrorState";
import { extractSerializedError } from "@/presentation/errorResponse";
import { buildHead } from "@/presentation/head";
import { boundedRedirectSource } from "@/presentation/redirect";
import { renderWorkspaceNoteList } from "../-action";

const WORKSPACE_INSUFFICIENT_ROLE = "WORKSPACE_INSUFFICIENT_ROLE";

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
  errorComponent: ({ error }) => {
    const serialized = extractSerializedError(error);
    return serialized.kind === "notFound" ||
      (serialized.kind === "business" &&
        serialized.code === WORKSPACE_INSUFFICIENT_ROLE) ? (
      <WorkspaceUnavailableState />
    ) : (
      <ServerErrorState />
    );
  },
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

/**
 * WS-02 の「除名された / 削除されたワークスペースを URL で直接開いた」。
 * 個人の文脈へ誘導する。
 */
function WorkspaceUnavailableState() {
  return (
    <ErrorState
      title="このワークスペースは開けません"
      body="削除されたか、メンバーから外れた可能性があります。個人の文脈に戻ります。"
      actions={<ErrorStateLink href="/notes">個人のノートへ</ErrorStateLink>}
    />
  );
}
