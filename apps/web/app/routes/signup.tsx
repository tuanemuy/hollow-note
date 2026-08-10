import { createFileRoute } from "@tanstack/react-router";
import { SignUpForm } from "@/components/auth/SignUpForm";
import { AuthLayout } from "@/components/layout/AuthLayout";
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
  // errorComponent は置かない: 失敗は router.tsx の
  // `defaultErrorComponent`（P-46 共通表示）へ委譲する。
  component: SignUpPage,
});

function SignUpPage() {
  return (
    <AuthLayout>
      <SignUpForm />
    </AuthLayout>
  );
}
