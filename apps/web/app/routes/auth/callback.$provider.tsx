import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { OAuthCallbackPanel } from "@/components/auth/OAuthCallbackPanel";
import { AuthLayout } from "@/components/layout/AuthLayout";
import { buildHead } from "@/presentation/head";
import { abandonOAuthFlowFn } from "./-action";

// GET はこの画面を描くだけで、state / code の消費はマウント後の POST が
// 行う（spec/adr/029 の GET / POST 分離）。プロバイダーが返す値は欠落・型不正でも「失敗」
// 状態として画面が扱うので、ここでは落とさない。
const searchSchema = z.object({
  state: z.string().min(1).max(512).optional().catch(undefined),
  code: z.string().min(1).max(4096).optional().catch(undefined),
  error: z.string().min(1).max(128).optional().catch(undefined),
});

export const Route = createFileRoute("/auth/callback/$provider")({
  validateSearch: (search) => searchSchema.parse(search),
  // 破棄を頼めるのは「マウント後の POST が起きない」かつ「照合に使う
  // `state` を伴う」組だけ。消費できる組で捨てると続く POST の束縛照合が
  // 落ち、`state` の無い組は照合できないので TTL 10 分に委ねる。
  loaderDeps: ({ search }) => ({
    abandonState:
      search.error !== undefined || search.code === undefined
        ? (search.state ?? null)
        : null,
  }),
  loader: async ({ deps }) => {
    if (deps.abandonState !== null) {
      await abandonOAuthFlowFn({ data: { state: deps.abandonState } });
    }
    return null;
  },
  head: ({ match }) => {
    const config = match.context?.config;
    if (!config) return {};
    const { meta, links } = buildHead(config, {
      title: `認可 — ${config.siteName}`,
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
