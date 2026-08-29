"use client";

import { useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useOptimistic, useState, useTransition } from "react";
import { errorTextClass } from "@/components/settings/panelStyles";
import { Alert } from "@/components/ui/Alert";
import { displayError } from "@/presentation/errorDisplay";
import { acceptInvitationFn } from "@/routes/invitations/-action";

/**
 * P-06 の操作（PAGE-p06-003 / -005）。サインイン済みのときだけ出る。
 *
 * 招待先のメールアドレスと、サインインしているアカウントのアドレスが
 * **異なるときだけ**、受諾の前に確認を挟む（WS-04）。判定はサーバー側で
 * 済ませて `mismatched` だけを受け取る — 閲覧者自身のアドレスをクライアント
 * へ流さないため。一致していれば手順 4 のとおり 1 クリックで参加する。
 *
 * 受諾は往復のあいだ「参加しました」を先に見せる — 遷移先の文脈が開くまで
 * ボタンが押されたままに見えるのを避けるため。失敗すればトランジションの
 * 終了で元のボタンへ戻る。
 *
 * 辞退はサーバー状態を変えない（招待は保留のまま残り、後から同じリンクで
 * 参加できる）ので、トップへ戻すだけにしてある。
 */

const primaryButtonClass =
  "inline-flex h-11 w-full items-center justify-center rounded-pill bg-accent px-5 text-sm font-medium text-bg transition-colors hover:bg-accent-hover active:bg-accent-pressed disabled:cursor-not-allowed disabled:opacity-55 disabled:hover:bg-accent";

const ghostButtonClass =
  "inline-flex h-11 w-full items-center justify-center rounded-pill px-5 text-sm font-medium text-ink-secondary transition-colors hover:bg-surface hover:text-ink disabled:cursor-not-allowed disabled:opacity-55";

export function InvitationActions({
  token,
  inviteeEmail,
  mismatched,
}: {
  token: string;
  inviteeEmail: string;
  mismatched: boolean;
}) {
  const router = useRouter();
  const acceptInvitation = useServerFn(acceptInvitationFn);

  const [joined, setJoined] = useOptimistic(
    false,
    (_current: boolean, next: boolean) => next,
  );
  const [isPending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onAccept = () => {
    setConfirming(false);
    startTransition(async () => {
      setJoined(true);
      let workspaceId: string;
      try {
        const view = await acceptInvitation({ data: { token } });
        workspaceId = view.workspaceId;
      } catch (failure) {
        setError(displayError(failure));
        return;
      }
      setError(null);
      // 参加はもう成立しているので、再取得と遷移の失敗を「参加できなかった」と
      // 見せない（try の外に置く）。この match は `staleTime` が無限なので、
      // invalidate しないと履歴の戻るで消費済みの招待に「参加する」が甦る。
      await router.invalidate();
      await router.navigate({
        to: "/workspaces/$workspaceId/notes",
        params: { workspaceId },
      });
    });
  };

  return (
    <div className="flex flex-col gap-2">
      {confirming ? (
        <Alert
          tone="warning"
          role="note"
          title="招待先とは別のアカウントでサインインしています"
          actions={
            <>
              <button
                type="button"
                className={primaryButtonClass}
                disabled={isPending}
                aria-busy={isPending}
                onClick={onAccept}
              >
                {joined ? "参加しました" : "このアカウントで参加する"}
              </button>
              <button
                type="button"
                className={ghostButtonClass}
                disabled={isPending}
                onClick={() => setConfirming(false)}
              >
                やめる
              </button>
            </>
          }
        >
          この招待は{" "}
          <b className="font-medium break-all text-ink">{inviteeEmail}</b>{" "}
          宛です。招待リンクを根拠に、いまサインインしているアカウントがメンバーになります。
        </Alert>
      ) : (
        <button
          type="button"
          className={primaryButtonClass}
          disabled={isPending}
          aria-busy={isPending}
          onClick={mismatched ? () => setConfirming(true) : onAccept}
        >
          {joined ? "参加しました" : "参加する"}
        </button>
      )}
      <button
        type="button"
        className={ghostButtonClass}
        disabled={isPending}
        onClick={() => {
          router.navigate({ to: "/" }).catch(() => {
            window.location.assign("/");
          });
        }}
      >
        参加しない
      </button>
      <p className={errorTextClass} role="status" aria-live="polite">
        {error}
      </p>
    </div>
  );
}
