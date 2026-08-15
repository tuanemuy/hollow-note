import { createFileRoute } from "@tanstack/react-router";
import { Suspense } from "react";
import { UsagePanelSkeleton } from "@/components/settings/UsagePanelSkeleton";
import { Deferred } from "@/components/ui/Deferred";
import { ServerErrorState } from "@/components/ui/ErrorState";
import { buildHead } from "@/presentation/head";
import { renderUsagePanel } from "./-action";

/**
 * P-24 使用量。認証ガードとタブ列は親の `/settings` が持つ。使用量は
 * fragment ストリーミングで、loader は未解決の promise をそのまま転送
 * する（await しない）ので遷移は即座に確定する。
 */
export const Route = createFileRoute("/settings/usage")({
  // 無期限で持てるのは、鮮度を各ミューテーションの `router.invalidate()`
  // が担うため。
  staleTime: import.meta.env.DEV ? 0 : Number.POSITIVE_INFINITY,
  loader: async () => {
    const { UsagePanel } = await renderUsagePanel();
    return { UsagePanel };
  },
  head: ({ match }) => {
    const config = match.context?.config;
    if (!config) return {};
    const { meta, links } = buildHead(config, {
      title: `使用量 — ${config.siteName}`,
      path: "/settings/usage",
    });
    return { meta, links };
  },
  component: SettingsUsagePage,
  errorComponent: () => <ServerErrorState />,
});

function SettingsUsagePage() {
  const { UsagePanel } = Route.useLoaderData();
  return (
    <Suspense fallback={<UsagePanelSkeleton />}>
      <Deferred promise={UsagePanel} />
    </Suspense>
  );
}
