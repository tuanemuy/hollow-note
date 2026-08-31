import { createFileRoute } from "@tanstack/react-router";
import { Suspense } from "react";
import { ReaderShell } from "@/components/layout/ReaderShell";
import { NoteEditorSkeleton } from "@/components/note/NoteEditor/skeleton";
import { Deferred } from "@/components/ui/Deferred";
import { ServerErrorState } from "@/components/ui/ErrorState";
import { buildHead } from "@/presentation/head";
import { boundedRedirectSource } from "@/presentation/redirect";
import { renderNewNoteEditor } from "./-action";

/**
 * P-12 の新規作成（個人文脈、`/notes/new`）。ノートはまだ存在せず、最初の
 * 自動保存で非公開のノートが作られて `/notes/:noteId/edit` へ置き換わる
 * （PAGE-p12-002）。
 *
 * 静的セグメントなので `/notes/$noteId` より先に一致する。
 */
export const Route = createFileRoute("/notes/new")({
  shouldReload: ({ cause }) => cause !== "preload",
  loader: ({ location }) =>
    renderNewNoteEditor({
      data: { redirect: boundedRedirectSource(location.href) },
    }),
  head: ({ match }) => {
    const config = match.context?.config;
    if (!config) return {};
    const { meta, links } = buildHead(config, {
      title: `ノートを作成 — ${config.siteName}`,
      path: "/notes/new",
    });
    return { meta, links };
  },
  component: NewNoteEditorPage,
  errorComponent: () => (
    <ReaderShell>
      <ServerErrorState />
    </ReaderShell>
  ),
});

function NewNoteEditorPage() {
  const { NoteEditor } = Route.useLoaderData();
  return (
    <Suspense fallback={<NoteEditorSkeleton />}>
      <Deferred promise={NoteEditor} />
    </Suspense>
  );
}
