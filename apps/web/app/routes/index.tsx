import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { PublicShell } from "@/components/layout/PublicShell";
import { lastScopeFn } from "@/components/layout/ScopeToken/action";
import { sessionUserFn } from "@/presentation/auth";
import { buildHead } from "@/presentation/head";

/**
 * P-40 トップ（最小形）。サインイン済みは表示中のスコープへリダイレクト
 * （spec/pages/index.md の URL 割り当て）。公開検索・特徴セクションは
 * 本スライス外のため hero と導線だけを出す。
 *
 * 引き継ぎ（WS-02「選択は次回の訪問時にも引き継がれる」）を読むのは
 * ここだけ。権限は遷移先が判定するので、ここでは記録された選択を信じる
 * — 除名済み・削除済みのワークスペースはその画面が個人へ誘導する。
 */
export const Route = createFileRoute("/")({
  beforeLoad: async () => {
    const user = await sessionUserFn();
    if (user === null) {
      return;
    }
    const scope = await lastScopeFn();
    throw scope.kind === "workspace"
      ? redirect({
          to: "/workspaces/$workspaceId/notes",
          params: { workspaceId: scope.workspaceId },
        })
      : redirect({ to: "/notes" });
  },
  head: ({ match }) => {
    const config = match.context?.config;
    if (!config) return {};
    const { meta, links } = buildHead(config, { path: "/" });
    return { meta, links };
  },
  component: LandingPage,
});

function LandingPage() {
  return (
    <PublicShell>
      <section className="mx-auto max-w-[var(--content-max)] px-4 pt-16 pb-20 text-center sm:px-6 sm:pt-20">
        <h1 className="text-3xl font-light tracking-tightest leading-tight">
          チームのための
          <br />
          ひとつのノート。
        </h1>
        <p className="mx-auto mt-5 max-w-[440px] text-base text-ink-secondary">
          どんなファイルもブラウザでそのまま読めるノートに変換して保存します。公開範囲はノートごとに
          3 段階から選べます。
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Link
            to="/signup"
            className="inline-flex h-11 items-center justify-center rounded-pill bg-accent px-6 text-sm font-medium text-bg transition-colors hover:bg-accent-hover active:bg-accent-pressed"
          >
            無料ではじめる
          </Link>
          <Link
            to="/signin"
            className="inline-flex h-11 items-center justify-center rounded-pill border border-hairline-strong bg-bg px-6 text-sm font-medium text-ink transition-colors hover:bg-surface"
          >
            サインイン
          </Link>
        </div>
      </section>
    </PublicShell>
  );
}
