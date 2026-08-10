import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { OAuthCallbackPanel } from "@/components/auth/OAuthCallbackPanel";
import { AuthLayout } from "@/components/layout/AuthLayout";
import { buildHead } from "@/presentation/head";

// GET はこの画面を描くだけで、state / code の消費はマウント後の POST が
// 行う（#1 ADR-029）。プロバイダーが返す値は欠落・型不正でも「失敗」
// 状態として画面が扱うので、ここでは落とさない。
const searchSchema = z.object({
  state: z.string().min(1).max(512).optional().catch(undefined),
  code: z.string().min(1).max(4096).optional().catch(undefined),
  error: z.string().min(1).max(128).optional().catch(undefined),
});

export const Route = createFileRoute("/auth/callback/$provider")({
  validateSearch: (search) => searchSchema.parse(search),
  head: ({ match }) => {
    const config = match.context?.config;
    if (!config) return {};
    const { meta, links } = buildHead(config, {
      title: `サインイン — ${config.siteName}`,
      path: "/auth/callback",
    });
    return { meta, links };
  },
  component: OAuthCallbackPage,
});

function OAuthCallbackPage() {
  const { provider } = Route.useParams();
  const { state, code, error } = Route.useSearch();
  return (
    <AuthLayout>
      <OAuthCallbackPanel
        provider={provider}
        state={state ?? null}
        code={code ?? null}
        error={error ?? null}
      />
    </AuthLayout>
  );
}
