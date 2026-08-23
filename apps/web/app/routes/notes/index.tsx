import { createFileRoute } from "@tanstack/react-router";
import { Suspense } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { NoteListSkeleton } from "@/components/note/NoteListSkeleton";
import { Deferred } from "@/components/ui/Deferred";
import { ServerErrorState } from "@/components/ui/ErrorState";
import { buildHead } from "@/presentation/head";
import { renderNoteList } from "./-action";

export const Route = createFileRoute("/notes/")({
  // この `staleTime` は下の `shouldReload` があるかぎり参照されない
  // （`shouldReload ?? staleMatchShouldReload` の左辺が常に非 undefined）。
  staleTime: import.meta.env.DEV ? 0 : Number.POSITIVE_INFINITY,
  // loader がガードを兼ねるので、`staleTime` のキャッシュにガードが埋もれ
  // ないよう毎ナビゲーション再実行させる（`beforeLoad` が持っていた性質）。
  // 関数形なのは `shouldReload: true` だと `preloadStaleTime` まで死んで
  // ホバーのたび要求が飛ぶため。ただし `cause !== "preload"` が preload を
  // 弾けるのは cached match だけで、アクティブなまま残る `/settings`
  // レイアウトのような match には効かない。
  shouldReload: ({ cause }) => cause !== "preload",
  loader: ({ location }) =>
    renderNoteList({ data: { redirect: location.href } }),
  head: ({ match }) => {
    const config = match.context?.config;
    if (!config) return {};
    const { meta, links } = buildHead(config, {
      title: `ノート一覧 — ${config.siteName}`,
      path: "/notes",
    });
    return { meta, links };
  },
  component: NotesPage,
  errorComponent: () => <ServerErrorState />,
});

function NotesPage() {
  const { user, NoteList } = Route.useLoaderData();
  return (
    <AppShell displayName={user.displayName} avatarUrl={user.avatarUrl}>
      <Suspense fallback={<NoteListSkeleton />}>
        <Deferred promise={NoteList} />
      </Suspense>
    </AppShell>
  );
}
