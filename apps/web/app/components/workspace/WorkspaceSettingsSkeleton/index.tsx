import type { ReactNode } from "react";
import {
  dangerPanelClass,
  panelClass,
} from "@/components/settings/panelStyles";
import { Skeleton } from "@/components/ui/Skeleton";

/**
 * ワークスペース設定 3 画面の per-fragment streaming 用フォールバック。
 * 差し替え時のレイアウトシフトを防ぐため、それぞれの DOM を写す。
 * 1 ファイルにまとめてあるのは、3 つが同じパネル recipe の並べ替えでしか
 * 違わないため。
 */
function SkeletonRoot({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div aria-busy="true">
      <span role="status" className="sr-only">
        {label}
      </span>
      {children}
    </div>
  );
}

export function WorkspaceGeneralSkeleton() {
  return (
    <SkeletonRoot label="ワークスペースの設定を読み込んでいます">
      <section className={panelClass}>
        <Skeleton className="h-5 w-32" />
        <Skeleton className="mt-2 h-4 w-64" />
        <div className="mt-5 flex items-center gap-4">
          <Skeleton className="size-14 rounded-lg" />
          <Skeleton className="h-8 w-28 rounded-pill" />
        </div>
        <Skeleton className="mt-5 h-4 w-16" />
        <Skeleton className="mt-2 h-11 w-full" />
        <Skeleton className="mt-5 h-4 w-16" />
        <Skeleton className="mt-2 h-20 w-full" />
      </section>
      <section className={panelClass}>
        <Skeleton className="h-5 w-28" />
        <Skeleton className="mt-2 h-4 w-72" />
        <Skeleton className="mt-5 h-4 w-20" />
        <Skeleton className="mt-2 h-11 w-full" />
        <Skeleton className="mt-2 h-3 w-56" />
      </section>
    </SkeletonRoot>
  );
}

export function WorkspaceMembersSkeleton() {
  return (
    <SkeletonRoot label="メンバーを読み込んでいます">
      <section className={panelClass}>
        <Skeleton className="h-5 w-36" />
        <Skeleton className="mt-2 h-4 w-72" />
        <Skeleton className="mt-5 h-10 w-full rounded-md" />
      </section>
      <section className={panelClass}>
        <Skeleton className="h-5 w-28" />
        {[0, 1, 2].map((row) => (
          <div key={row} className="mt-4 flex items-center gap-3">
            <Skeleton className="size-8 rounded-full" />
            <div className="min-w-0 flex-1">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="mt-2 h-3 w-56" />
            </div>
            <Skeleton className="h-7.5 w-24 rounded-md" />
          </div>
        ))}
      </section>
    </SkeletonRoot>
  );
}

export function WorkspacePublishSkeleton() {
  return (
    <SkeletonRoot label="公開設定を読み込んでいます">
      <section className={panelClass}>
        <Skeleton className="h-5 w-40" />
        <Skeleton className="mt-2 h-4 w-full" />
        <Skeleton className="mt-5 h-11 w-full" />
        <Skeleton className="mt-5 h-10 w-44 rounded-pill" />
      </section>
    </SkeletonRoot>
  );
}

export function WorkspaceDangerSkeleton() {
  return (
    <SkeletonRoot label="削除の説明を読み込んでいます">
      <section className={dangerPanelClass}>
        <Skeleton className="h-5 w-44" />
        <Skeleton className="mt-4 h-4 w-64" />
        <Skeleton className="mt-2 h-4 w-72" />
        <Skeleton className="mt-5 h-4 w-56" />
        <Skeleton className="mt-2 h-11 w-full" />
        <Skeleton className="mt-4 h-10 w-52 rounded-pill" />
      </section>
    </SkeletonRoot>
  );
}
