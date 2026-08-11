import { panelClass } from "@/components/settings/panelStyles";
import { Skeleton } from "@/components/ui/Skeleton";

/**
 * `/settings/profile` の per-fragment streaming 用フォールバック。
 * `ProfileForm` の DOM（2 パネル + 下部のアクションバー）を写して、
 * 差し替え時のレイアウトシフトを防ぐ。
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
      </section>
      <section className={panelClass}>
        <Skeleton className="h-5 w-32" />
        <Skeleton className="mt-2 h-4 w-72" />
        <Skeleton className="mt-5 h-4 w-24" />
        <Skeleton className="mt-2 h-11 w-full" />
      </section>
    </div>
  );
}
