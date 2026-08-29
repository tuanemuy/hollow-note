import { createFileRoute } from "@tanstack/react-router";
import { Suspense } from "react";
import { AuthLayout } from "@/components/layout/AuthLayout";
import { Deferred } from "@/components/ui/Deferred";
import { ServerErrorState } from "@/components/ui/ErrorState";
import { Skeleton } from "@/components/ui/Skeleton";
import { buildHead } from "@/presentation/head";
import { renderInvitationPreview } from "./-action";

/**
 * P-06 招待の確認。認証レイアウト（L-03）の上に断片を流す。
 *
 * トークンはパスから来る外部入力なので、転送境界の検証は bridge の
 * `.validator` が持つ。`head` の canonical はトークンを含めない
 * — 招待リンクそのものが秘密なので、共有可能な URL として書き出さない。
 */
export const Route = createFileRoute("/invitations/$token")({
  staleTime: import.meta.env.DEV ? 0 : Number.POSITIVE_INFINITY,
  loader: async ({ params }) => {
    const { InvitationPreview } = await renderInvitationPreview({
      data: { token: params.token },
    });
    return { InvitationPreview };
  },
  head: ({ match }) => {
    const config = match.context?.config;
    if (!config) return {};
    const { meta, links } = buildHead(config, {
      title: `招待の確認 — ${config.siteName}`,
      path: "/invitations",
    });
    return {
      meta: [...meta, { name: "robots", content: "noindex, nofollow" }],
      links,
    };
  },
  component: InvitationPage,
  errorComponent: () => (
    <AuthLayout>
      <ServerErrorState />
    </AuthLayout>
  ),
});

function InvitationPage() {
  const { InvitationPreview } = Route.useLoaderData();
  return (
    <AuthLayout>
      <Suspense fallback={<InvitationSkeleton />}>
        <Deferred promise={InvitationPreview} />
      </Suspense>
    </AuthLayout>
  );
}

function InvitationSkeleton() {
  return (
    <div aria-busy="true" className="flex flex-col items-center">
      <span role="status" className="sr-only">
        招待を読み込んでいます
      </span>
      <Skeleton className="size-11 rounded-lg" />
      <Skeleton className="mt-5 h-6 w-64" />
      <Skeleton className="mt-3 h-4 w-72" />
      <Skeleton className="mt-6 h-36 w-full rounded-lg" />
      <Skeleton className="mt-6 h-11 w-full rounded-pill" />
    </div>
  );
}
