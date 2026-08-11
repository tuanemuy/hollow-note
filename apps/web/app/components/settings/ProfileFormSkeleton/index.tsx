import { panelClass } from "@/components/settings/panelStyles";
import { Skeleton } from "@/components/ui/Skeleton";

/**
 * `/settings/profile` の per-fragment streaming 用フォールバック。
 * `ProfileForm` の DOM（2 パネル + 各欄の常設注記 + 下部のアクション
 * バー）を写して、差し替え時のレイアウトシフトを防ぐ。ハンドル変更の
 * 警告はハンドルを設定済みの利用者にしか出ないので置かない。
 */
export function ProfileFormSkeleton() {
  return (
    <div aria-busy="true">
      <span role="status" className="sr-only">
        プロフィールを読み込んでいます
      </span>
      <section className={panelClass}>
        <Skeleton className="h-5 w-40" />
        <Skeleton className="mt-2 h-4 w-56" />
        <div className="mt-5 flex items-center gap-4">
          <Skeleton className="size-16 rounded-full" />
          <Skeleton className="h-8 w-28 rounded-pill" />
        </div>
        <Skeleton className="mt-5 h-4 w-20" />
        <Skeleton className="mt-2 h-11 w-full" />
        <Skeleton className="mt-5 h-4 w-24" />
        <Skeleton className="mt-2 h-22 w-full" />
        <Skeleton className="mt-2 h-3 w-24" />
      </section>
      <section className={panelClass}>
        <Skeleton className="h-5 w-32" />
        <Skeleton className="mt-2 h-4 w-72" />
        <Skeleton className="mt-5 h-4 w-24" />
        <Skeleton className="mt-2 h-11 w-full" />
        <Skeleton className="mt-2 h-3 w-56" />
      </section>
      <div className="-mx-4 border-t border-hairline px-4 py-2 sm:-mx-6 sm:px-6">
        <div className="mx-auto flex max-w-[var(--list-max)] items-center justify-end gap-2">
          <Skeleton className="h-8 w-28 rounded-pill" />
          <Skeleton className="h-10 w-16 rounded-pill" />
        </div>
      </div>
    </div>
  );
}
