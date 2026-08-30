import { createFileRoute } from "@tanstack/react-router";
import { Suspense } from "react";
import { ReaderShell } from "@/components/layout/ReaderShell";
import { NoteDetailSkeleton } from "@/components/note/NoteDetailSkeleton";
import { Deferred } from "@/components/ui/Deferred";
import { NotFoundState, ServerErrorState } from "@/components/ui/ErrorState";
import { extractSerializedError } from "@/presentation/errorResponse";
import { buildHead } from "@/presentation/head";
import { boundedRedirectSource } from "@/presentation/redirect";
import { renderNoteDetail } from "./-action";

export const Route = createFileRoute("/notes/$noteId")({
  // loader がガードを兼ねるので毎ナビゲーション再実行させる。関数形なのは
  // `shouldReload: true` だと `preloadStaleTime` まで死んでホバーのたび要求が
  // 飛ぶため。ただし `cause !== "preload"` が preload を弾けるのは cached
  // match だけで、アクティブなまま残る `/settings` レイアウトのような match
  // には効かない。また既訪 match の再実行は背景枝に落ちるので、失効後は前回の
  // `loaderData` が 1 往復ぶん表示されてから redirect する
  // （`beforeLoad` のブロッキング性は戻らない）。成功する再取得でスケルトンに
  // 戻らないのは背景枝だからではなく、`Deferred` が断片 promise の差し替えを
  // deferred lane に載せているため。
  shouldReload: ({ cause }) => cause !== "preload",
  loader: ({ params, location }) =>
    renderNoteDetail({
      data: {
        noteId: params.noteId,
        redirect: boundedRedirectSource(location.href),
      },
    }),
  head: ({ match }) => {
    const config = match.context?.config;
    if (!config) return {};
    const { meta, links } = buildHead(config, {
      title: `ノート — ${config.siteName}`,
      path: `/notes/${match.params.noteId}`,
    });
    return { meta, links };
  },
  component: NoteDetailPage,
  // 不在・他人の非公開・権限なしは NOTE_NOT_FOUND に収斂して届く
  // （UC-note-002）。P-46 と同じく存在と権限を区別しない。
  errorComponent: ({ error }) => {
    const serialized = extractSerializedError(error);
    return serialized.kind === "notFound" ? (
      <ReaderShell>
        <NotFoundState />
      </ReaderShell>
    ) : (
      <ReaderShell>
        <ServerErrorState />
      </ReaderShell>
    );
  },
});

function NoteDetailPage() {
  const { NoteDetail } = Route.useLoaderData();
  return (
    <ReaderShell>
      <Suspense fallback={<NoteDetailSkeleton />}>
        <Deferred promise={NoteDetail} />
      </Suspense>
    </ReaderShell>
  );
}
