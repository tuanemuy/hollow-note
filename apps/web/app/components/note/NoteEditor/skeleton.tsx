import { Skeleton } from "@/components/ui/Skeleton";
import { BackLink, type BackTarget, barClass, pageClass } from "./frame";

/**
 * P-12 の「読み込み中」（既存ノートの編集への遷移直後）。`NoteEditor` の
 * DOM（上部バー + タイトル + 書式バー + 本文）を写す。
 *
 * 上部バーを**ここで描く**のは、編集画面のシェルが島（`NoteEditorIsland`）
 * と `EditorShell` の中にしか無く、断片が届くまでのあいだ画面から戻る導線が
 * 1 つも消えてしまうためである。戻り先はルートの params から決まるので、
 * 島の到着を待たずに描ける。
 */
export function NoteEditorSkeleton({ backTo }: { backTo: BackTarget }) {
  return (
    <div className="min-h-dvh">
      <header className={barClass}>
        <BackLink target={backTo} label="ノートへ戻る" />
      </header>
      <main aria-busy="true" className={pageClass}>
        {/* `role="status"` は読み上げの 1 行だけに置く（`<main>` の
            ランドマークを潰さないため）。 */}
        <span role="status" className="sr-only">
          ノートを読み込んでいます
        </span>
        <Skeleton className="mb-6 h-10 w-4/5" />
        <div className="mb-5 flex gap-2 border-b border-hairline pt-2 pb-4">
          <Skeleton className="h-[30px] w-16" />
          <Skeleton className="h-[30px] w-16" />
          <Skeleton className="h-[30px] w-16" />
        </div>
        <div className="space-y-3">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-11/12" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/5" />
        </div>
      </main>
    </div>
  );
}
