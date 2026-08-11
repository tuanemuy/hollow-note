import { createFileRoute } from "@tanstack/react-router";
import { DeleteAccountPanel } from "@/components/settings/DeleteAccountPanel";
import { ServerErrorState } from "@/components/ui/ErrorState";
import { buildHead } from "@/presentation/head";

/**
 * P-25 アカウント削除。認証ガードとタブ列は親の `/settings` が持つ。
 *
 * loader を持たないのは、この画面が読み出すサーバー状態を持たないため
 * （説明文と確認入力だけで、進捗は受理後に ticket で引く）。フラグメント
 * ストリーミングも要らないので、島をそのまま描く。
 */
export const Route = createFileRoute("/settings/danger")({
  staleTime: import.meta.env.DEV ? 0 : Number.POSITIVE_INFINITY,
  head: ({ match }) => {
    const config = match.context?.config;
    if (!config) return {};
    const { meta, links } = buildHead(config, {
      title: `アカウント削除 — ${config.siteName}`,
      path: "/settings/danger",
    });
    return { meta, links };
  },
  component: SettingsDangerPage,
  errorComponent: () => <ServerErrorState />,
});

function SettingsDangerPage() {
  return <DeleteAccountPanel />;
}
