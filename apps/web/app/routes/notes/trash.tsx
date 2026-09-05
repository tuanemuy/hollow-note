import { createFileRoute } from "@tanstack/react-router";
import { Suspense } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { NoteListSkeleton } from "@/components/note/NoteListSkeleton";
import { Deferred } from "@/components/ui/Deferred";
import { ServerErrorState } from "@/components/ui/ErrorState";
import { buildHead } from "@/presentation/head";
import { boundedRedirectSource } from "@/presentation/redirect";
import { renderTrashList } from "./-action";

/**
 * P-14 の個人文脈（`/notes/trash`、ED-10 手順 1 の行き先）。
 *
 * `shouldReload` / `loader` ガードの扱いは `/notes` と同じ理由による。
 */
export const Route = createFileRoute("/notes/trash")({
  shouldReload: ({ cause }) => cause !== "preload",
  loader: ({ location }) =>
    renderTrashList({
      data: { redirect: boundedRedirectSource(location.href) },
    }),
  head: ({ match }) => {
    const config = match.context?.config;
    if (!config) return {};
    const { meta, links } = buildHead(config, {
      title: `ゴミ箱 — ${config.siteName}`,
      path: "/notes/trash",
    });
    return { meta, links };
  },
  component: TrashPage,
  errorComponent: () => <ServerErrorState />,
});

function TrashPage() {
  const { user, TrashList } = Route.useLoaderData();
  return (
    <AppShell displayName={user.displayName} avatarUrl={user.avatarUrl}>
      <Suspense fallback={<NoteListSkeleton />}>
        <Deferred promise={TrashList} />
      </Suspense>
    </AppShell>
  );
}
