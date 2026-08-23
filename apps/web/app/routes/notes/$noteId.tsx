import { createFileRoute, Link } from "@tanstack/react-router";
import { type ReactNode, Suspense } from "react";
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
  // deferred lane に載せているため（`.thread/13/adr.md` の ADR-005）。
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

/**
 * P-11 の読むシェル: 上部バーは前の文脈へ戻る導線だけの最小形
 * （spec/pages/index.md#L-01 読む画面の変形）。パレットは未機能のため
 * トリガーごと出さない — 一覧側と違い、この画面はバーの要素が導線
 * 1 つでも成立する。
 */
function ReaderShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-40 flex h-[var(--bar-height)] items-center gap-2 bg-[var(--bar-bg)] px-4 backdrop-blur-xl backdrop-saturate-150 sm:px-6">
        <Link
          to="/notes"
          className="inline-flex h-8 min-w-0 items-center gap-1 rounded-md px-2 text-sm text-ink-secondary transition-colors hover:bg-surface hover:text-ink"
        >
          <svg
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <polyline points="15 18 9 12 15 6" />
          </svg>
          <span className="truncate">ノート一覧</span>
        </Link>
      </header>
      {children}
    </div>
  );
}

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
