import { createFileRoute } from "@tanstack/react-router";
import { SignUpForm } from "@/components/auth/SignUpForm";
import { AuthLayout } from "@/components/layout/AuthLayout";
import { sanitizeRouteError } from "@/presentation/errorDisplay";
import { buildHead } from "@/presentation/head";

export const Route = createFileRoute("/signup")({
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

function SignUpPage() {
  return (
    <AuthLayout>
      <SignUpForm />
    </AuthLayout>
  );
}
