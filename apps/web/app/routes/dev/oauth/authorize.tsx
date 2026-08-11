import { createFileRoute, notFound } from "@tanstack/react-router";
import { z } from "zod";
import { DevConsentForm } from "@/components/dev/DevConsentForm";
import { AuthLayout } from "@/components/layout/AuthLayout";
import { buildHead } from "@/presentation/head";
import { loadDevOAuthModeFn } from "../-action";

// 認可エンドポイントのクエリー。`code_challenge_method` は
// S256 のみを受ける — 他の方式は dev アダプターが発行しない。
const searchSchema = z.object({
  client_id: z.string().min(1).max(128),
  redirect_uri: z.string().min(1).max(2048),
  state: z.string().min(1).max(512),
  code_challenge: z.string().min(1).max(512),
  code_challenge_method: z.literal("S256"),
  response_type: z.literal("code").optional(),
  scope: z.string().max(512).optional(),
});

/**
 * dev IdP の同意画面。`OAUTH_DEV_MODE` が偽なら 404 に倒すので、
 * production ビルドでこの画面が開く状態は存在しない（真との併用は起動時
 * エラー）。
 */
export const Route = createFileRoute("/dev/oauth/authorize")({
  validateSearch: (search) => searchSchema.parse(search),
  loader: async () => {
    const { enabled } = await loadDevOAuthModeFn();
    if (!enabled) {
      throw notFound();
    }
    return null;
  },
  head: ({ match }) => {
    const config = match.context?.config;
    if (!config) return {};
    const { meta, links } = buildHead(config, {
      title: `開発用 ID プロバイダー — ${config.siteName}`,
      path: "/dev/oauth/authorize",
    });
    return { meta, links };
  },
  component: DevAuthorizePage,
});

function DevAuthorizePage() {
  const search = Route.useSearch();
  return (
    <AuthLayout>
      <DevConsentForm
        redirectUri={search.redirect_uri}
        state={search.state}
        codeChallenge={search.code_challenge}
      />
    </AuthLayout>
  );
}
