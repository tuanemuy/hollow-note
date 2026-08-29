"use client";

import type { WorkspacePublicationStatusView } from "@repo/core/application/workspace/view";
import { Link, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useOptimistic, useState, useTransition } from "react";
import {
  errorTextClass,
  ghostButtonClass,
  panelClass,
  panelNoteClass,
  panelTitleClass,
  primaryButtonClass,
  subtleButtonClass,
} from "@/components/settings/panelStyles";
import { Alert } from "@/components/ui/Alert";
import { displayError } from "@/presentation/errorDisplay";
import {
  publishWorkspaceFn,
  unpublishWorkspaceFn,
} from "@/routes/workspaces/$workspaceId/settings/-action";

/**
 * P-33 の公開切り替えを持つ島（PAGE-p33-001..003）。
 *
 * 公開状態はこのパネルが持つ状態なので、切り替えは葉のまま
 * `useOptimistic` + `useTransition` で先に反映し、`router.invalidate()` で
 * サーバー truth に戻す。破壊的ではないが後戻りに手間がかかる操作なので、
 * 切り替えは 1 段の確認を挟む（P-33「切り替え確認」）。
 *
 * 公開 URL と公開ノート件数を同じ楽観状態に束ねてあるのは、3 つが 1 回の
 * 切り替えで一緒に動くため。`publishWorkspace` の応答が確定値を持つので、
 * 再取得を待たずに書き戻す。
 */

type Confirming = "publish" | "unpublish" | null;

type PublicationState = Readonly<{
  published: boolean;
  publicUrl: string | null;
  publicNoteCount: number;
}>;

export function WorkspacePublishBoard({
  publication,
}: {
  publication: WorkspacePublicationStatusView;
}) {
  const router = useRouter();
  const publish = useServerFn(publishWorkspaceFn);
  const unpublish = useServerFn(unpublishWorkspaceFn);

  const [state, applyPublication] = useOptimistic<
    PublicationState,
    Partial<PublicationState>
  >(
    {
      published: publication.publication === "published",
      publicUrl: publication.publicUrl,
      publicNoteCount: publication.publicNoteCount,
    },
    (current, patch) => ({ ...current, ...patch }),
  );
  const [confirming, setConfirming] = useState<Confirming>(null);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [copyNotice, setCopyNotice] = useState<string | null>(null);

  const workspaceId = publication.workspaceId;
  const readOnly = !publication.canPublish;
  const slugMissing = publication.slug === null;
  const { published, publicUrl, publicNoteCount } = state;

  const reconcile = () =>
    router.invalidate().catch(() => {
      console.error("Workspace publication reconcile failed");
    });

  const run = (next: "publish" | "unpublish") => {
    setConfirming(null);
    startTransition(async () => {
      // 楽観的な反映。失敗すればトランジションの終了で元の値へ戻る。
      applyPublication({ published: next === "publish" });
      try {
        if (next === "publish") {
          const view = await publish({ data: { workspaceId } });
          applyPublication({
            publicUrl: view.publicUrl,
            publicNoteCount: view.publicNoteCount,
          });
        } else {
          await unpublish({ data: { workspaceId } });
          applyPublication({ publicUrl: null });
        }
      } catch (failure) {
        setError(displayError(failure));
        return;
      }
      setError(null);
      await reconcile();
    });
  };

  const onCopy = () => {
    if (publicUrl === null) return;
    navigator.clipboard
      .writeText(publicUrl)
      .then(() => setCopyNotice("公開ページの URL をコピーしました"))
      .catch(() =>
        setCopyNotice(
          "コピーできませんでした。URL を選択してコピーしてください",
        ),
      );
  };

  return (
    <>
      {readOnly ? (
        <Alert tone="info" title="読み取り専用です" role="note">
          公開の切り替えができるのは owner だけです。
        </Alert>
      ) : null}

      {slugMissing ? (
        <Alert
          tone="warning"
          role="note"
          title="公開するにはスラッグの設定が必要です"
          actions={
            <Link
              to="/workspaces/$workspaceId/settings/general"
              params={{ workspaceId }}
              className={subtleButtonClass}
            >
              一般設定へ
            </Link>
          }
        >
          公開ページの URL に使うスラッグがまだありません。
        </Alert>
      ) : null}

      <section className={panelClass}>
        <h2 className={panelTitleClass}>
          公開ページ
          <span
            className={`ml-2 inline-flex h-6 items-center rounded-pill px-2 text-xs font-medium ${
              published
                ? "bg-success-surface text-success"
                : "bg-surface text-ink-secondary"
            }`}
          >
            {published ? "公開中" : "非公開"}
          </span>
        </h2>
        <p className={panelNoteClass}>
          公開に設定したノートだけが、誰でも読める一覧として並びます。非公開・リンク限定のノートは出ません。
        </p>

        {published ? (
          <p className="mb-5 text-sm text-ink-secondary">
            非公開に戻すと、URL
            を知っていても開けなくなります。個々のノートの公開ステータスは変わらないので、公開のままのノートはそのノート自身の
            URL
            で引き続き読めます。検索エンジンの掲載が消えるまでには時間がかかります。
          </p>
        ) : (
          <p className="mb-5 text-sm text-ink-secondary">
            公開しても、個々のノートの公開ステータスは変わりません。
          </p>
        )}

        {publicUrl !== null && published ? (
          <div className="mb-5 flex flex-wrap items-center gap-2 rounded-md border border-hairline px-3 py-2">
            <span className="min-w-0 flex-1 truncate font-mono text-sm text-ink-secondary">
              {publicUrl}
            </span>
            <button type="button" className={ghostButtonClass} onClick={onCopy}>
              コピー
            </button>
            {/* 公開ページは別文脈（未サインインでも開ける画面）なので、
                ルーター遷移ではなく素のリンクで開く。 */}
            <a
              className={ghostButtonClass}
              href={publicUrl}
              target="_blank"
              rel="noreferrer"
            >
              開く
            </a>
          </div>
        ) : null}

        <p
          className="text-xs text-ink-tertiary not-empty:mb-3"
          role="status"
          aria-live="polite"
        >
          {copyNotice}
        </p>

        {publicNoteCount === 0 ? (
          <Alert
            tone="warning"
            role="status"
            title="公開ページは空のままです"
            actions={
              <Link
                to="/workspaces/$workspaceId/notes"
                params={{ workspaceId }}
                className={subtleButtonClass}
              >
                ノート一覧を開く
              </Link>
            }
          >
            公開ステータスが「公開」のノートがまだありません。ノート一覧から公開したいものを選んでください。
          </Alert>
        ) : (
          <p className="mb-5 text-sm text-ink-secondary">
            <b className="font-semibold text-ink">{publicNoteCount}</b>{" "}
            {published
              ? "件のノートが公開されています"
              : "件のノートが公開ページに並びます"}
          </p>
        )}

        {readOnly ? null : confirming !== null ? (
          <div className="rounded-md border border-hairline p-4">
            <p className="mb-3 text-sm text-ink-secondary">
              {confirming === "publish"
                ? "公開ページを有効にします。公開ステータスのノートが誰でも読める一覧に並びます。"
                : "公開ページを無効にします。URL を知っていても開けなくなります。"}
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className={primaryButtonClass}
                disabled={isPending}
                onClick={() => run(confirming)}
              >
                {confirming === "publish" ? "公開する" : "非公開にする"}
              </button>
              <button
                type="button"
                className={ghostButtonClass}
                disabled={isPending}
                onClick={() => setConfirming(null)}
              >
                キャンセル
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            className={published ? ghostButtonClass : primaryButtonClass}
            disabled={isPending || (!published && slugMissing)}
            aria-busy={isPending}
            onClick={() => setConfirming(published ? "unpublish" : "publish")}
          >
            {isPending
              ? "変更中..."
              : published
                ? "非公開に戻す"
                : "公開ページを有効にする"}
          </button>
        )}

        <p className={errorTextClass} role="status" aria-live="polite">
          {error}
        </p>
      </section>
    </>
  );
}
