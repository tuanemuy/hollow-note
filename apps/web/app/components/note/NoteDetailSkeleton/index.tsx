import { Skeleton } from "@/components/ui/Skeleton";

/**
 * /notes/$noteId の per-fragment streaming 用フォールバック。`NoteDetail`
 * の DOM（kicker + タイトル + 本文段落）を写す（P-11 読み込み中状態）。
 */
export function NoteDetailSkeleton() {
  return (
    <main
      aria-busy="true"
      className="mx-auto max-w-[var(--content-max)] px-4 pt-10 pb-16 sm:px-6"
    >
      {/* `role="status"` sits on the announcement, not on `<main>` — the
          role would otherwise replace the main landmark. */}
      <span role="status" className="sr-only">
        ノートを読み込んでいます
      </span>
      <div className="mb-4 flex items-center gap-2">
        <Skeleton className="h-3 w-14" />
        <Skeleton className="h-3 w-24" />
      </div>
      <Skeleton className="mb-8 h-10 w-4/5" />
      <div className="space-y-3">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-11/12" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-3/5" />
      </div>
    </main>
  );
}
