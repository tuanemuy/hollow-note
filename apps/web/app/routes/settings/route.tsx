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
  // ガードを `beforeLoad` ではなく `loader` に置くのは、子ルートの断片
  // loader と並列に走らせるため（`beforeLoad` は match 順に逐次）。
  // このレイアウト match は子ルート間の遷移では `cause: "stay"` のまま
  // 生き残り、`staleMatchShouldReload` が偽になるので、毎ナビゲーションの
  // 再判定（＝下の `location.pathname` の分岐）はこの `shouldReload` が担う。
  // `cause !== "preload"` が preload を弾けるのは cached match だけなので、
  // このレイアウト match に対しては実質いつも真になる。
  shouldReload: ({ cause }) => cause !== "preload",
  loader: {
    // `staleReloadMode` はオブジェクト形の loader でしか読まれない（関数形は
    // `undefined` 扱い）。`"blocking"` でないと再実行がデタッチされた背景枝へ
    // 落ち、その catch は preload かどうかを見ずに `router.navigate` するので、
    // タブ列にホバーしただけで `/signin` へ実ナビゲートしてしまう。
    // ブロッキングなら失効時も子を描画する前に `/signin` へ抜ける。
    staleReloadMode: "blocking",
    handler: async ({ location }) => {
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
