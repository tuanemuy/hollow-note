import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { SettingsTabs } from "@/components/layout/SettingsTabs";
import { ServerErrorState } from "@/components/ui/ErrorState";
import { safeRedirectPath, sessionUserFn } from "@/presentation/auth";
import { buildHead } from "@/presentation/head";

/**
 * 設定のレイアウトルート（L-01 + P-20 タブ列）。個々の設定画面は子
 * ルートで、タブ列と認証ガードをここに集約する。
 */

/**
 * P-25 だけはセッションが無くても開ける。削除の受理はその
 * 応答でセッションを失効させるので、進捗を追う唯一の手段である status
 * ticket を持ったままリロードした利用者をサインインへ飛ばすと、自分の
 * 削除の行方を読めなくなる。他のタブは開いても何も操作できないため、
 * この状態ではシェルもタブ列も出さない。
 */
const SIGNED_OUT_PATH = "/settings/danger";

export const Route = createFileRoute("/settings")({
  staleTime: import.meta.env.DEV ? 0 : Number.POSITIVE_INFINITY,
  beforeLoad: async ({ location }) => {
    const user = await sessionUserFn();
    if (user !== null) {
      return { user };
    }
    if (location.pathname === SIGNED_OUT_PATH) {
      return { user: null };
    }
    throw redirect({
      to: "/signin",
      search: { redirect: safeRedirectPath(location.href) },
    });
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
  if (user === null) {
    return <SettingsColumn />;
  }
  return (
    <AppShell displayName={user.displayName} avatarUrl={user.avatarUrl}>
      <SettingsColumn>
        <SettingsTabs />
      </SettingsColumn>
    </AppShell>
  );
}

function SettingsColumn({ children }: { children?: ReactNode }) {
  return (
    <main className="mx-auto max-w-[var(--list-max)] px-4 pt-8 pb-20 sm:px-6 sm:pt-10 lg:pt-16">
      <h1 className="mb-5 text-3xl font-light tracking-tightest leading-tight">
        設定
      </h1>
      {children}
      <Outlet />
    </main>
  );
}
