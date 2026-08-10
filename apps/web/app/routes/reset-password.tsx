import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { ResetPasswordPanel } from "@/components/auth/ResetPasswordPanel";
import { AuthLayout } from "@/components/layout/AuthLayout";
import { buildHead } from "@/presentation/head";

// GET はこのページの描画だけで状態を変更しない。token の欠落・型不正は
// 申請モードとして扱うため、ここでは落とさない。
const searchSchema = z.object({
  token: z.string().min(1).max(512).optional().catch(undefined),
});

export const Route = createFileRoute("/reset-password")({
  validateSearch: (search) => searchSchema.parse(search),
  head: ({ match }) => {
    const config = match.context?.config;
    if (!config) return {};
    const { meta, links } = buildHead(config, {
      title: `パスワード再設定 — ${config.siteName}`,
      path: "/reset-password",
    });
    return { meta, links };
  },
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
  const { token } = Route.useSearch();
  return (
    <AuthLayout>
      <ResetPasswordPanel token={token ?? null} />
    </AuthLayout>
  );
}
