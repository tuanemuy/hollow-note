import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { SignUpForm } from "@/components/auth/SignUpForm";
import { AuthLayout } from "@/components/layout/AuthLayout";
import { buildHead } from "@/presentation/head";
import { REDIRECT_MAX_LENGTH, safeRedirectPath } from "@/presentation/redirect";

// `/signin` と同じ復帰先の受け取り方（同一オリジンのパスだけを通し、
// 不正値は既定の /notes へ黙って倒す）。招待 URL から新規登録へ入った
// 場合に、登録の完了後もそのまま招待へ戻れるようにするためのもの
// （PAGE-p06-004）。
const searchSchema = z.object({
  redirect: z.string().max(REDIRECT_MAX_LENGTH).optional().catch(undefined),
});

export const Route = createFileRoute("/signup")({
  validateSearch: (search) => searchSchema.parse(search),
  head: ({ match }) => {
    const config = match.context?.config;
    if (!config) return {};
    const { meta, links } = buildHead(config, {
      title: `アカウントを作る — ${config.siteName}`,
      path: "/signup",
    });
    return { meta, links };
  },
  component: SignUpPage,
});

function SignUpPage() {
  const { redirect } = Route.useSearch();
  return (
    <AuthLayout>
      <SignUpForm redirectTo={safeRedirectPath(redirect)} />
    </AuthLayout>
  );
}
