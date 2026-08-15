import { Skeleton } from "@/components/ui/Skeleton";

const SECTIONS = ["storage", "llm"] as const;

/**
 * `/settings/usage` の per-fragment streaming 用フォールバック。
 * `UsagePanel` の DOM（更新時刻 + 2 セクション + 削除への導線行）を写して、
 * 差し替え時のレイアウトシフトを防ぐ。警告のアラートは出るとは限らないので
 * 置かない。
 */
export function UsagePanelSkeleton() {
  return (
    <div aria-busy="true">
      {/* `role="status"` は告知だけに付ける。 */}
      <span role="status" className="sr-only">
        使用量を読み込んでいます
      </span>
      <Skeleton className="mb-6 h-4 w-32" />
      {SECTIONS.map((section) => (
        <div key={section} className="border-t border-hairline py-5">
          <div className="mb-3 flex items-baseline gap-3">
            <Skeleton className="h-5 w-28" />
            <Skeleton className="ml-auto h-5 w-24" />
          </div>
          <Skeleton className="h-1.5 w-full rounded-full" />
          <Skeleton className="mt-2 h-3 w-40" />
        </div>
      ))}
      <div className="flex items-center gap-3 border-t border-hairline py-5">
        <Skeleton className="h-4 w-60" />
        <Skeleton className="ml-auto h-8 w-32 rounded-pill" />
      </div>
    </div>
  );
}
