import { panelClass } from "@/components/settings/panelStyles";
import { Skeleton } from "@/components/ui/Skeleton";

const ROWS = ["a", "b"] as const;

/**
 * `/settings/auth` の per-fragment streaming 用フォールバック。
 * `IdentityList` の DOM（3 パネルと 2 行）を写して、差し替え時の
 * レイアウトシフトを防ぐ。
 */
export function IdentityListSkeleton() {
  return (
    <div aria-busy="true">
      {/* `role="status"` は告知だけに付ける。 */}
      <span role="status" className="sr-only">
        ログイン方法を読み込んでいます
      </span>
      <section className={panelClass}>
        <Skeleton className="h-5 w-40" />
        <Skeleton className="mt-2 h-4 w-56" />
        <div className="mt-5">
          {ROWS.map((row) => (
            <div
              key={row}
              className="grid grid-cols-[auto_1fr_auto] items-center gap-3 border-t border-hairline py-4 first:border-t-0 first:pt-0"
            >
              <Skeleton className="size-8 rounded-md" />
              <span className="min-w-0">
                <Skeleton className="h-4 w-48" />
                <Skeleton className="mt-2 h-3 w-32" />
              </span>
              <Skeleton className="h-8 w-16 rounded-pill" />
            </div>
          ))}
        </div>
      </section>
      <section className={panelClass}>
        <Skeleton className="h-5 w-36" />
        <Skeleton className="mt-2 h-4 w-64" />
        <Skeleton className="mt-5 h-11 w-full" />
        <Skeleton className="mt-5 h-11 w-full" />
        <Skeleton className="mt-5 h-10 w-40 rounded-pill" />
      </section>
      <section className={panelClass}>
        <Skeleton className="h-5 w-48" />
        <Skeleton className="mt-2 h-4 w-72" />
        <Skeleton className="mt-5 h-8 w-64 rounded-pill" />
      </section>
    </div>
  );
}
