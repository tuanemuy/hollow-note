import { createFileRoute } from "@tanstack/react-router";
import { Suspense } from "react";
import { ReaderShell } from "@/components/layout/ReaderShell";
import { NoteEditorSkeleton } from "@/components/note/NoteEditor/skeleton";
import { Deferred } from "@/components/ui/Deferred";
import { ServerErrorState } from "@/components/ui/ErrorState";
import { buildHead } from "@/presentation/head";
import { boundedRedirectSource } from "@/presentation/redirect";
import { renderWorkspaceNewNoteEditor } from "../-action";

/**
 * P-12 の新規作成のワークスペース版
 * （`/workspaces/:workspaceId/notes/new`）。作成先は URL が決めるので
 * 取り込み先を選ばせない。viewer と非メンバーの拒否は初回保存の
 * `createBlankNote` が返す（この画面はワークスペースを読まない）。
 */
export const Route = createFileRoute("/workspaces/$workspaceId/notes/new")({
  shouldReload: ({ cause }) => cause !== "preload",
  loader: ({ params, location }) =>
    renderWorkspaceNewNoteEditor({
      data: {
        workspaceId: params.workspaceId,
        redirect: boundedRedirectSource(location.href),
      },
    }),
  head: ({ match }) => {
    const config = match.context?.config;
    if (!config) return {};
    const { meta, links } = buildHead(config, {
      title: `ノートを作成 — ${config.siteName}`,
      path: `/workspaces/${match.params.workspaceId}/notes/new`,
    });
    return { meta, links };
  },
  component: WorkspaceNewNoteEditorPage,
  errorComponent: () => {
    const { workspaceId } = Route.useParams();
    return (
      <ReaderShell workspaceId={workspaceId}>
        <ServerErrorState />
      </ReaderShell>
    );
  },
});

function WorkspaceNewNoteEditorPage() {
  const { workspaceId } = Route.useParams();
  const { NoteEditor } = Route.useLoaderData();
  return (
    <Suspense
      fallback={
        <NoteEditorSkeleton backTo={{ kind: "workspaceNotes", workspaceId }} />
      }
    >
      <Deferred promise={NoteEditor} />
    </Suspense>
  );
}
