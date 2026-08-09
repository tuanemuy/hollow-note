import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { SignInForm } from "@/components/auth/SignInForm";
import { AuthLayout } from "@/components/layout/AuthLayout";
import { safeRedirectPath } from "@/presentation/auth";
import { sanitizeRouteError } from "@/presentation/errorDisplay";
import { buildHead } from "@/presentation/head";

// `redirect` は同一オリジンのパスだけを受け入れる（オープンリダイレクト
// 防止）。不正値は既定の /notes へ黙って倒す。
const searchSchema = z.object({
  redirect: z.string().max(2048).optional().catch(undefined),
});

export const Route = createFileRoute("/signin")({
  validateSearch: (search) => searchSchema.parse(search),
  head: ({ match }) => {
    const config = match.context?.config;
    if (!config) return {};
    const { meta, links } = buildHead(config, {
      title: `サインイン — ${config.siteName}`,
      path: "/signin",
    });
    return { meta, links };
  },
  component: SignInPage,
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

function SignInPage() {
  const { redirect } = Route.useSearch();
  return (
    <AuthLayout>
      <SignInForm redirectTo={safeRedirectPath(redirect)} />
    </AuthLayout>
  );
}
