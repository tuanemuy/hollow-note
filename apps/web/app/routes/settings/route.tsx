import { createFileRoute, Outlet } from "@tanstack/react-router";
import { AppShell } from "@/components/layout/AppShell";
import { SettingsTabs } from "@/components/layout/SettingsTabs";
import { ServerErrorState } from "@/components/ui/ErrorState";
import { requireAuthenticated } from "@/presentation/auth";
import { buildHead } from "@/presentation/head";

/**
 * 設定のレイアウトルート（L-01 + P-20 タブ列）。個々の設定画面は子
 * ルートで、タブ列と認証ガードをここに集約する。
 */
export const Route = createFileRoute("/settings")({
  staleTime: import.meta.env.DEV ? 0 : Number.POSITIVE_INFINITY,
  beforeLoad: async ({ location }) => {
    const user = await requireAuthenticated(location.href);
    return { user };
  },
  head: ({ match }) => {
    const config = match.context?.config;
    if (!config) return {};
    const { meta, links } = buildHead(config, {
      title: `設定 — ${config.siteName}`,
      path: "/settings",
    });
    return { meta, links };
  },
  component: SettingsLayout,
  errorComponent: () => <ServerErrorState />,
});

function SettingsLayout() {
  const { user } = Route.useRouteContext();
  return (
    <AppShell displayName={user.displayName} avatarUrl={user.avatarUrl}>
      <main className="mx-auto max-w-[var(--list-max)] px-4 pt-8 pb-20 sm:px-6 sm:pt-10 lg:pt-16">
        <h1 className="mb-5 text-3xl font-light tracking-tightest leading-tight">
          設定
        </h1>
        <SettingsTabs />
        <Outlet />
      </main>
    </AppShell>
  );
}
