import { Skeleton } from "@/components/ui/Skeleton";

const ROWS = [
  { id: "a", title: "w-3/5", sub: "w-2/5" },
  { id: "b", title: "w-1/2", sub: "w-1/2" },
  { id: "c", title: "w-2/3", sub: "w-1/3" },
  { id: "d", title: "w-1/2", sub: "w-2/5" },
  { id: "e", title: "w-3/5", sub: "w-1/3" },
] as const;

/**
 * /notes の per-fragment streaming 用フォールバック。`NoteList` の DOM
 * （page-head + toolbar + 行）を写して差し替え時のレイアウトシフトを防ぐ
 * （モック P10-notes-empty.html 状態 3）。
 */
export function NoteListSkeleton() {
  return (
    <main
      role="status"
      aria-busy="true"
      aria-live="polite"
      className="mx-auto max-w-[var(--list-max)] px-4 pt-8 pb-20 sm:px-6 sm:pt-10 lg:pt-16"
    >
      <span className="sr-only">ノートを読み込んでいます</span>
      <div className="mb-6">
        <Skeleton className="h-9 w-24" />
        <Skeleton className="mt-2 h-4 w-32" />
      </div>
      <div className="mb-3 flex items-center gap-2">
        <Skeleton className="h-[30px] w-24" />
      </div>
      <div>
        {ROWS.map((row) => (
          <div
            key={row.id}
            className="grid grid-cols-[1fr_auto] items-start gap-3 px-2 py-3"
          >
            <span className="min-w-0">
              <Skeleton className={`h-4 ${row.title}`} />
              <Skeleton className={`mt-2 h-3 ${row.sub}`} />
            </span>
            <Skeleton className="h-3 w-12" />
          </div>
        ))}
      </div>
    </main>
  );
}
