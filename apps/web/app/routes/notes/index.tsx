import { createFileRoute } from "@tanstack/react-router";
import { Suspense } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { NoteListSkeleton } from "@/components/note/NoteListSkeleton";
import { Deferred } from "@/components/ui/Deferred";
import { ServerErrorState } from "@/components/ui/ErrorState";
import { requireAuthenticated } from "@/presentation/auth";
import { buildHead } from "@/presentation/head";
import { renderNoteList } from "./-action";

export const Route = createFileRoute("/notes/")({
  // 無期限で持てるのは、鮮度を各ミューテーションの `router.invalidate()`
  // が担うため。
  staleTime: import.meta.env.DEV ? 0 : Number.POSITIVE_INFINITY,
  beforeLoad: async ({ location }) => {
    const user = await requireAuthenticated(location.href);
    return { user };
  },
  loader: async () => {
    const { NoteList } = await renderNoteList();
    return { NoteList };
  },
  head: ({ match }) => {
    const config = match.context?.config;
    if (!config) return {};
    const { meta, links } = buildHead(config, {
      title: `ノート一覧 — ${config.siteName}`,
      path: "/notes",
    });
    return { meta, links };
  },
  component: NotesPage,
  errorComponent: () => <ServerErrorState />,
});

function NotesPage() {
  const { NoteList } = Route.useLoaderData();
  const { user } = Route.useRouteContext();
  return (
    <AppShell displayName={user.displayName} avatarUrl={user.avatarUrl}>
      <Suspense fallback={<NoteListSkeleton />}>
        <Deferred promise={NoteList} />
      </Suspense>
    </AppShell>
  );
}
