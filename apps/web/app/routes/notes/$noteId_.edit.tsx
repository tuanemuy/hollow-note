import { createFileRoute } from "@tanstack/react-router";
import { Suspense } from "react";
import { ReaderShell } from "@/components/layout/ReaderShell";
import { NoteEditorSkeleton } from "@/components/note/NoteEditor/skeleton";
import { Deferred } from "@/components/ui/Deferred";
import { NotFoundState, ServerErrorState } from "@/components/ui/ErrorState";
import { extractSerializedError } from "@/presentation/errorResponse";
import { buildHead } from "@/presentation/head";
import { boundedRedirectSource } from "@/presentation/redirect";
import { renderNoteEditor } from "./-action";

/**
 * P-12 ノート編集（個人文脈、`/notes/:noteId/edit`）。
 *
 * シェルは断片ではなく画面が持つ（`NoteEditor` が上部バーと下端操作バーを
 * 含む 1 つの島を描く）。ここが `AppShell` / `ReaderShell` を被せないのは、
 * 編集画面の上部バーがモード切替と保存状態を載せる別物だからで、エラー時
 * だけは戻り先を残すために `ReaderShell` に落とす。
 *
 * `shouldReload` / `loader` ガードの扱いは `/notes/:noteId` と同じ理由による。
 */
export const Route = createFileRoute("/notes/$noteId_/edit")({
  shouldReload: ({ cause }) => cause !== "preload",
  loader: ({ params, location }) =>
    renderNoteEditor({
      data: {
        noteId: params.noteId,
        redirect: boundedRedirectSource(location.href),
      },
    }),
  head: ({ match }) => {
    const config = match.context?.config;
    if (!config) return {};
    const { meta, links } = buildHead(config, {
      title: `ノートを編集 — ${config.siteName}`,
      path: `/notes/${match.params.noteId}/edit`,
    });
    return { meta, links };
  },
  component: NoteEditorPage,
  // 不在・他人の非公開・権限なしは NOTE_NOT_FOUND に収斂して届く。
  errorComponent: ({ error }) => {
    const serialized = extractSerializedError(error);
    return (
      <ReaderShell>
        {serialized.kind === "notFound" ? (
          <NotFoundState />
        ) : (
          <ServerErrorState />
        )}
      </ReaderShell>
    );
  },
});

function NoteEditorPage() {
  const { noteId } = Route.useParams();
  const { NoteEditor } = Route.useLoaderData();
  return (
    <Suspense
      fallback={<NoteEditorSkeleton backTo={{ kind: "note", noteId }} />}
    >
      <Deferred promise={NoteEditor} />
    </Suspense>
  );
}
