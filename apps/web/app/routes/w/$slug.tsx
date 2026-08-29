import { createFileRoute } from "@tanstack/react-router";
import { Suspense } from "react";
import { z } from "zod";
import { PublicShell } from "@/components/layout/PublicShell";
import { Deferred } from "@/components/ui/Deferred";
import { ServerErrorState } from "@/components/ui/ErrorState";
import { Skeleton } from "@/components/ui/Skeleton";
import { buildHead } from "@/presentation/head";
import { PUBLIC_SLUG_MAX_LENGTH, renderPublicWorkspace } from "./-action";

/**
 * P-43 ワークスペースの公開ページ（`/w/:slug`）。
 *
 * 公開区分の URL なので認証ガードを持たない。検索語とタグは URL の
 * 検索パラメータが正本で、転送境界の検証はここ（`validateSearch`）と
 * ブリッジの `.validator` の 2 箇所で閉じる。壊れた値は `catch` で
 * 既定へ倒し、公開ページが検索パラメータのせいで開けなくならないように
 * する。
 */
const searchSchema = z.object({
  q: z.string().max(200).optional().catch(undefined),
  tags: z.array(z.string().min(1).max(64)).max(10).optional().catch(undefined),
});

export const Route = createFileRoute("/w/$slug")({
  validateSearch: (search) => searchSchema.parse(search),
  loaderDeps: ({ search }) => ({
    keyword: search.q ?? "",
    tags: search.tags ?? [],
  }),
  loader: ({ params, deps }) =>
    renderPublicWorkspace({
      data: {
        slug: params.slug.slice(0, PUBLIC_SLUG_MAX_LENGTH),
        keyword: deps.keyword,
        tags: deps.tags,
      },
    }),
  head: ({ match, loaderData }) => {
    const config = match.context?.config;
    if (!config) return {};
    const workspace = loaderData?.workspace ?? null;
    const { meta, links } = buildHead(config, {
      title:
        workspace === null
          ? `ワークスペース — ${config.siteName}`
          : `${workspace.name} — ${config.siteName}`,
      ...(workspace !== null && workspace.description !== ""
        ? { description: workspace.description }
        : {}),
      path: `/w/${match.params.slug}`,
    });
    return { meta, links };
  },
  component: PublicWorkspaceRoute,
  errorComponent: () => (
    <PublicShell>
      <ServerErrorState />
    </PublicShell>
  ),
});

function PublicWorkspaceRoute() {
  const { PublicWorkspacePage } = Route.useLoaderData();
  return (
    <PublicShell>
      <Suspense fallback={<PublicWorkspaceSkeleton />}>
        <Deferred promise={PublicWorkspacePage} />
      </Suspense>
    </PublicShell>
  );
}

function PublicWorkspaceSkeleton() {
  return (
    <div
      aria-busy="true"
      className="mx-auto max-w-[var(--list-max)] px-4 pt-10 pb-16 sm:px-6 sm:pt-12"
    >
      <span role="status" className="sr-only">
        ワークスペースを読み込んでいます
      </span>
      <div className="mb-8 flex gap-4">
        <Skeleton className="size-16 rounded-lg" />
        <div className="flex-1">
          <Skeleton className="h-7 w-56" />
          <Skeleton className="mt-2 h-4 w-40" />
          <Skeleton className="mt-3 h-4 w-full max-w-[420px]" />
        </div>
      </div>
      <Skeleton className="mb-6 h-9 w-full rounded-pill" />
      <Skeleton className="h-4 w-full max-w-[520px]" />
      <Skeleton className="mt-4 h-4 w-full max-w-[460px]" />
    </div>
  );
}
