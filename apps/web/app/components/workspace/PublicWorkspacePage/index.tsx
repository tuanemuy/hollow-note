import type { PublicWorkspaceView } from "@repo/core/application/workspace/view";
import { Alert } from "@/components/ui/Alert";
import { ErrorState, ErrorStateLink } from "@/components/ui/ErrorState";
import { serializeError } from "@/presentation/errorResponse";
import { loadPublicWorkspace, loadViewerWorkspaceRole } from "./action";
import { PublicWorkspaceFilters } from "./filters";

/**
 * P-43 ワークスペースの公開ページ（モック P43-workspace-public.html、
 * PAGE-p43-001..003）。
 *
 * **未サインインで到達する画面**なので、描くものは `getPublicWorkspace`
 * が返した公開射影だけに限る。セッションが解決できたときに増えるのは
 * 「これは外から見えている表示です」のバナー 1 枚で、ノートの内容も件数も
 * 閲覧者によって変わらない。
 *
 * 公開ノートの一覧は**まだ 0 件しか返せない**。正本は
 * `PublicNoteQueryService.searchPublic`（公開投影）だが、ノートの公開状態を
 * その投影へ書く経路が無く、読み口も `RequestContainer` に出ていない
 * （`application/workspace/publicNoteCount.ts` の JSDoc が同じ理由を述べて
 * いる）。したがってこの画面は正本の現在の答え — どの条件でも 0 件 — を
 * そのまま描く。検索語とタグは URL に載るので、読み出しユースケースが
 * 入った時点でこのセクションだけを差し替えられる。
 */
export async function PublicWorkspacePage({
  slug,
  userId,
  appUrl,
  keyword,
  tags,
}: {
  slug: string;
  userId: string | null;
  appUrl: string;
  keyword: string;
  tags: readonly string[];
}) {
  // 断片の中で throw すると Flight ストリームを素の Error が渡り、`kind`
  // を失ってからルートの境界に届く。終端表示はここで描く。
  let workspace: PublicWorkspaceView;
  try {
    workspace = await loadPublicWorkspace(slug);
  } catch (error) {
    if (serializeError(error).kind === "notFound") {
      return <PublicWorkspaceNotFound />;
    }
    throw error;
  }

  // 2 本目は best-effort。得られるのはバナー 1 枚で、2 本の読みのあいだに
  // 削除サガが行を落とすとここが reject し、**サインイン済みの閲覧者だけ**が
  // 上の「見つかりません」ではなく一時的な障害の表示へ落ちる。
  const role =
    userId === null
      ? null
      : await loadViewerWorkspaceRole(workspace.workspaceId, userId).catch(
          () => null,
        );

  return (
    <main className="mx-auto max-w-[var(--list-max)] px-4 pt-10 pb-16 sm:px-6 sm:pt-12">
      {role === null ? null : <MemberBanner />}

      <div className="mb-8 flex flex-wrap items-start gap-4">
        {workspace.avatarUrl === null ? (
          <span
            aria-hidden="true"
            className="inline-flex size-16 shrink-0 items-center justify-center rounded-lg bg-ink text-lg font-medium text-bg"
          >
            {workspace.name.trim().slice(0, 2) || "?"}
          </span>
        ) : (
          <img
            src={workspace.avatarUrl}
            alt=""
            width={64}
            height={64}
            className="size-16 shrink-0 rounded-lg object-cover"
          />
        )}
        <div className="min-w-[240px] flex-1">
          <h1 className="text-2xl font-normal tracking-tightest leading-snug">
            {workspace.name}
          </h1>
          <p className="mt-1 text-sm text-ink-tertiary">
            {slugPrefix(appUrl)}
            {workspace.slug}
          </p>
          {workspace.description === "" ? null : (
            <p className="mt-3 text-sm text-ink-secondary">
              {workspace.description}
            </p>
          )}
        </div>
      </div>

      <PublicWorkspaceFilters
        slug={workspace.slug}
        keyword={keyword}
        tags={tags}
      />

      <section aria-label="公開ノート">
        <PublicNotesEmpty filtered={keyword.length > 0 || tags.length > 0} />
      </section>
    </main>
  );
}

/**
 * 公開ページの見出しに出すスラッグは P-30 / P-31 のスラッグ欄と同じ整形に
 * 揃える（モック P43-workspace-public.html も `hollow.app/w/…`）。ここだけ
 * パスにすると、いちばん共有されやすい画面の表記だけが割れる。
 */
function slugPrefix(appUrl: string): string {
  try {
    return `${new URL(appUrl).host}/w/`;
  } catch {
    return "/w/";
  }
}

function MemberBanner() {
  return (
    <div className="mb-3">
      <Alert tone="info" title="これは外から見えている表示です" role="note">
        公開に設定したノートだけが並びます。ワークスペース内の非公開のノートはここに出ません。
      </Alert>
    </div>
  );
}

function PublicNotesEmpty({ filtered }: { filtered: boolean }) {
  return (
    <div className="px-4 py-16 text-center">
      <span className="mb-4 inline-flex text-ink-tertiary">
        <svg
          width="26"
          height="26"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
        </svg>
      </span>
      <p className="mb-2 text-md font-medium">
        {filtered
          ? "条件に合う公開ノートはありません"
          : "まだ公開されているノートはありません"}
      </p>
      <p className="text-sm text-ink-secondary">
        {filtered
          ? "条件を解除すると、このワークスペースの公開ノートが並びます。"
          : "このワークスペースがノートを公開すると、ここに並びます。"}
      </p>
    </div>
  );
}

/**
 * 非公開・削除済み・不在スラッグ・不正スラッグはすべて同じ表示に畳む
 * （`getPublicWorkspace` が 1 つの `WORKSPACE_NOT_FOUND` に収斂させている
 * のと同じ理由 — 存在を漏らさない）。
 */
export function PublicWorkspaceNotFound() {
  return (
    <ErrorState
      title="このワークスペースは見つかりません"
      body="URL が変わったか、公開が取り下げられた可能性があります。"
      actions={<ErrorStateLink href="/">トップへ</ErrorStateLink>}
    />
  );
}
