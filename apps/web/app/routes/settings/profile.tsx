import { createFileRoute } from "@tanstack/react-router";
import { Suspense } from "react";
import { ProfileFormSkeleton } from "@/components/settings/ProfileFormSkeleton";
import { Deferred } from "@/components/ui/Deferred";
import { ServerErrorState } from "@/components/ui/ErrorState";
import { buildHead } from "@/presentation/head";
import { renderProfileForm } from "./-action";

/**
 * P-21 プロフィール設定。認証ガードとタブ列は親の `/settings` が持つ。
 * フォームは fragment ストリーミングで、loader は未解決の promise を
 * そのまま転送する（await しない）ので遷移は即座に確定する。
 */
export const Route = createFileRoute("/settings/profile")({
  // 無期限で持てるのは、鮮度を各ミューテーションの `router.invalidate()`
  // が担うため。
  staleTime: import.meta.env.DEV ? 0 : Number.POSITIVE_INFINITY,
  loader: async () => {
    const { ProfileForm } = await renderProfileForm();
    return { ProfileForm };
  },
  head: ({ match }) => {
    const config = match.context?.config;
    if (!config) return {};
    const { meta, links } = buildHead(config, {
      title: `プロフィール — ${config.siteName}`,
      path: "/settings/profile",
    });
    return { meta, links };
  },
  component: SettingsProfilePage,
  errorComponent: () => <ServerErrorState />,
});

function SettingsProfilePage() {
  const { ProfileForm } = Route.useLoaderData();
  return (
    <Suspense fallback={<ProfileFormSkeleton />}>
      <Deferred promise={ProfileForm} />
    </Suspense>
  );
}
