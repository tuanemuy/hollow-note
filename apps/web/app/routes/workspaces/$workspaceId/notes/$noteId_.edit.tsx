import { createFileRoute } from "@tanstack/react-router";
import { Suspense } from "react";
import { ReaderShell } from "@/components/layout/ReaderShell";
import { NoteEditorSkeleton } from "@/components/note/NoteEditor/skeleton";
import { Deferred } from "@/components/ui/Deferred";
import { NotFoundState, ServerErrorState } from "@/components/ui/ErrorState";
import { extractSerializedError } from "@/presentation/errorResponse";
import { buildHead } from "@/presentation/head";
import { boundedRedirectSource } from "@/presentation/redirect";
import { renderWorkspaceNoteEditor } from "../-action";

/**
 * P-12 のワークスペース文脈版
 * （`/workspaces/:workspaceId/notes/:noteId/edit`）。個人の
 * `/notes/:noteId/edit` と同じ画面で、文脈だけが URL から来る。
 *
 * 一覧型と違ってワークスペース自身は読まない — 扱うのはノート 1 件で、
 * 認可は `getNote` が持ち、非メンバー・削除済み・権限なしはすべて
 * `NOTE_NOT_FOUND` に収斂する。
 */
export const Route = createFileRoute(
  "/workspaces/$workspaceId/notes/$noteId_/edit",
)({
  shouldReload: ({ cause }) => cause !== "preload",
  loader: ({ params, location }) =>
    renderWorkspaceNoteEditor({
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
      title: `ノートを編集 — ${config.siteName}`,
      path: `/workspaces/${match.params.workspaceId}/notes/${match.params.noteId}/edit`,
    });
    return { meta, links };
  },
  component: WorkspaceNoteEditorPage,
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

function WorkspaceNoteEditorPage() {
  const { workspaceId, noteId } = Route.useParams();
  const { NoteEditor } = Route.useLoaderData();
  return (
    <Suspense
      fallback={
        <NoteEditorSkeleton
          backTo={{ kind: "workspaceNote", noteId, workspaceId }}
        />
      }
    >
      <Deferred promise={NoteEditor} />
    </Suspense>
  );
}
