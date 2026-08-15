import { createFileRoute } from "@tanstack/react-router";
import { Suspense } from "react";
import { IdentityListSkeleton } from "@/components/settings/IdentityListSkeleton";
import { Deferred } from "@/components/ui/Deferred";
import { ServerErrorState } from "@/components/ui/ErrorState";
import { buildHead } from "@/presentation/head";
import { renderIdentityList } from "./-action";

/**
 * P-22 ログイン方法設定。認証ガードとタブ列は親の `/settings` が持つ。
 * 一覧は fragment ストリーミングで、loader は未解決の promise をその
 * まま転送する（await しない）ので遷移は即座に確定する。
 */
export const Route = createFileRoute("/settings/auth")({
  // 無期限で持てるのは、鮮度を各ミューテーションの `router.invalidate()`
  // が担うため。
  staleTime: import.meta.env.DEV ? 0 : Number.POSITIVE_INFINITY,
  loader: async () => {
    const { IdentityList } = await renderIdentityList();
    return { IdentityList };
  },
  head: ({ match }) => {
    const config = match.context?.config;
    if (!config) return {};
    const { meta, links } = buildHead(config, {
      title: `ログイン方法 — ${config.siteName}`,
      path: "/settings/auth",
    });
    return { meta, links };
  },
  component: SettingsAuthPage,
  errorComponent: () => <ServerErrorState />,
});

function SettingsAuthPage() {
  const { IdentityList } = Route.useLoaderData();
  return (
    <Suspense fallback={<IdentityListSkeleton />}>
      <Deferred promise={IdentityList} />
    </Suspense>
  );
}
