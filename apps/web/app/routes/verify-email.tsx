import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { VerifyEmailPanel } from "@/components/auth/VerifyEmailPanel";
import { AuthLayout } from "@/components/layout/AuthLayout";
import { sanitizeRouteError } from "@/presentation/errorDisplay";
import { buildHead } from "@/presentation/head";

// GET はこのページの描画だけで状態を変更しない（ADR-007）。token の欠落・
// 型不正は「無効」状態として画面側で扱うため、ここでは落とさない。
const searchSchema = z.object({
  token: z.string().min(1).max(512).optional().catch(undefined),
});

export const Route = createFileRoute("/verify-email")({
  validateSearch: (search) => searchSchema.parse(search),
  head: ({ match }) => {
    const config = match.context?.config;
    if (!config) return {};
    const { meta, links } = buildHead(config, {
      title: `メール確認 — ${config.siteName}`,
      path: "/verify-email",
    });
    return { meta, links };
  },
  component: VerifyEmailPage,
  errorComponent: ({ error }) => (
    <AuthLayout>
      <div role="alert">
        <h1 className="text-xl font-medium">エラーが発生しました</h1>
        <p className="mt-3 text-sm text-ink-secondary">
          {sanitizeRouteError(error)}
        </p>
      </div>
    </AuthLayout>
  ),
});

function VerifyEmailPage() {
  const { token } = Route.useSearch();
  return (
    <AuthLayout>
      <VerifyEmailPanel token={token ?? null} />
    </AuthLayout>
  );
}
