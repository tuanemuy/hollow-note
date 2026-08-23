import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { SettingsTabs } from "@/components/layout/SettingsTabs";
import { ServerErrorState } from "@/components/ui/ErrorState";
import { sessionUserFn } from "@/presentation/auth";
import { buildHead } from "@/presentation/head";
import { safeRedirectPath } from "@/presentation/redirect";

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
  // この `staleTime` は下の `shouldReload` があるかぎり参照されない
  // （`shouldReload ?? staleMatchShouldReload` の左辺が常に非 undefined）。
  staleTime: import.meta.env.DEV ? 0 : Number.POSITIVE_INFINITY,
  // ガードを `beforeLoad` ではなく `loader` に置くのは、子ルートの断片
  // loader と並列に走らせるため（`beforeLoad` は match 順に逐次）。
  // 関数形なのは `shouldReload: true` だと `preloadStaleTime` まで死んで
  // ホバーのたび要求が飛ぶため。ただし `cause !== "preload"` が preload を
  // 弾けるのは cached match だけで、このレイアウト match は子ルート間の
  // preload ではアクティブなまま（`cause: "stay"`）なので効かない。
  shouldReload: ({ cause }) => cause !== "preload",
  loader: async ({ location }) => {
    const user = await sessionUserFn();
    if (user !== null) {
      return { user };
    }
    // このレイアウト match は子ルート間の遷移でも生き残るので、`loader` は
    // ナビゲーションごとには走らない（`cause: "stay"` かつ
    // `previousRouteMatchId === match.id` で `staleMatchShouldReload` が偽）。
    // 上の `shouldReload` があって初めて再実行される。`location.pathname`
    // の分岐は「パスが変われば自動で再判定される」ものではない。
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
  const { user } = Route.useLoaderData();
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
