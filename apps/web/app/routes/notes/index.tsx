import { createFileRoute } from "@tanstack/react-router";
import { Suspense } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { NoteListSkeleton } from "@/components/note/NoteListSkeleton";
import { Deferred } from "@/components/ui/Deferred";
import { ServerErrorState } from "@/components/ui/ErrorState";
import { buildHead } from "@/presentation/head";
import { boundedRedirectSource } from "@/presentation/redirect";
import { renderNoteList } from "./-action";

export const Route = createFileRoute("/notes/")({
  // loader がガードを兼ねるので毎ナビゲーション再実行させる。関数形なのは
  // `shouldReload: true` だと `preloadStaleTime` まで死んでホバーのたび要求が
  // 飛ぶため。ただし `cause !== "preload"` が preload を弾けるのは cached
  // match だけで、アクティブなまま残る `/settings` レイアウトのような match
  // には効かない。また既訪 match の再実行は背景枝に落ちるので、失効後は前回の
  // `loaderData` が 1 往復ぶん表示されてから redirect する
  // （`beforeLoad` のブロッキング性は戻らない）。成功する再取得でスケルトンに
  // 戻らないのは背景枝だからではなく、`Deferred` が断片 promise の差し替えを
  // deferred lane に載せているため（`.thread/13/adr.md` の ADR-005）。
  shouldReload: ({ cause }) => cause !== "preload",
  loader: ({ location }) =>
    renderNoteList({
      data: { redirect: boundedRedirectSource(location.href) },
    }),
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
