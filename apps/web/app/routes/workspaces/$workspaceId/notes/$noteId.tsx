import { createFileRoute } from "@tanstack/react-router";
import { Suspense } from "react";
import { ReaderShell } from "@/components/layout/ReaderShell";
import { NoteDetailSkeleton } from "@/components/note/NoteDetailSkeleton";
import { Deferred } from "@/components/ui/Deferred";
import { NotFoundState, ServerErrorState } from "@/components/ui/ErrorState";
import { extractSerializedError } from "@/presentation/errorResponse";
import { buildHead } from "@/presentation/head";
import { boundedRedirectSource } from "@/presentation/redirect";
import { renderWorkspaceNoteDetail } from "../-action";

/**
 * P-11 のワークスペース文脈版（`/workspaces/:workspaceId/notes/:noteId`）。
 * 個人の `/notes/:noteId` と同じ画面で、文脈だけが URL から来る。
 * OR-12 の「アプリ内の URL は新しい所属先の文脈のものに変わる」は、この
 * URL と `/notes/:noteId` の 2 つが揃って初めて成り立つ。
 *
 * `shouldReload` / `loader` ガードの扱いは `/notes/:noteId` と同じ理由による。
 */
export const Route = createFileRoute("/workspaces/$workspaceId/notes/$noteId")({
  shouldReload: ({ cause }) => cause !== "preload",
  loader: ({ params, location }) =>
    renderWorkspaceNoteDetail({
      data: {
        workspaceId: params.workspaceId,
        noteId: params.noteId,
        redirect: boundedRedirectSource(location.href),
      },
    }),
  head: ({ match }) => {
    const config = match.context?.config;
    if (!config) return {};
    const { meta, links } = buildHead(config, {
      title: `ノート — ${config.siteName}`,
      path: `/workspaces/${match.params.workspaceId}/notes/${match.params.noteId}`,
    });
    return { meta, links };
  },
  component: WorkspaceNoteDetailPage,
  // 不在・非メンバー・権限なしは NOTE_NOT_FOUND に収斂して届く
  // （UC-note-002）。個人側と同じく存在と権限を区別しない。
  errorComponent: ({ error }) => {
    const { workspaceId } = Route.useParams();
    const serialized = extractSerializedError(error);
    return (
      <ReaderShell workspaceId={workspaceId}>
        {serialized.kind === "notFound" ? (
          <NotFoundState />
        ) : (
          <ServerErrorState />
        )}
      </ReaderShell>
    );
  },
});

function WorkspaceNoteDetailPage() {
  const { workspaceId } = Route.useParams();
  const { NoteDetail } = Route.useLoaderData();
  return (
    <ReaderShell workspaceId={workspaceId}>
      <Suspense fallback={<NoteDetailSkeleton />}>
        <Deferred promise={NoteDetail} />
      </Suspense>
    </ReaderShell>
  );
}
