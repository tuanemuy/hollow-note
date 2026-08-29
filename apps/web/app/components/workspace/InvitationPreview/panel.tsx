"use client";

import { useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useOptimistic, useState, useTransition } from "react";
import { errorTextClass } from "@/components/settings/panelStyles";
import { displayError } from "@/presentation/errorDisplay";
import { acceptInvitationFn } from "@/routes/invitations/-action";

/**
 * P-06 の操作（PAGE-p06-003 / -005）。サインイン済みのときだけ出る。
 *
 * 受諾は往復のあいだ「参加しました」を先に見せる — 遷移先の文脈が開くまで
 * ボタンが押されたままに見えるのを避けるため。失敗すればトランジションの
 * 終了で元の 2 つのボタンへ戻る。
 *
 * 辞退はサーバー状態を変えない（招待は保留のまま残り、後から同じリンクで
 * 参加できる）ので、トップへ戻すだけにしてある。
 */
export function InvitationActions({ token }: { token: string }) {
  const router = useRouter();
  const acceptInvitation = useServerFn(acceptInvitationFn);

  const [joined, setJoined] = useOptimistic(
    false,
    (_current: boolean, next: boolean) => next,
  );
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const onAccept = () => {
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
      // 参加はもう成立しているので、遷移の失敗を「参加できなかった」と
      // 見せない（try の外に置く）。
      await router.navigate({
        to: "/workspaces/$workspaceId/settings/general",
        params: { workspaceId },
      });
    });
  };

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        className="inline-flex h-11 w-full items-center justify-center rounded-pill bg-accent px-5 text-sm font-medium text-bg transition-colors hover:bg-accent-hover active:bg-accent-pressed disabled:cursor-not-allowed disabled:opacity-55 disabled:hover:bg-accent"
        disabled={isPending}
        aria-busy={isPending}
        onClick={onAccept}
      >
        {joined ? "参加しました" : "参加する"}
      </button>
      <button
        type="button"
        className="inline-flex h-11 w-full items-center justify-center rounded-pill px-5 text-sm font-medium text-ink-secondary transition-colors hover:bg-surface hover:text-ink disabled:cursor-not-allowed disabled:opacity-55"
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
