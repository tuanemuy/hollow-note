"use client";

import { useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useActionState, useEffect, useId, useRef, useState } from "react";
import {
  fieldErrorClass,
  fieldLabelClass,
  inputClass,
  inputInvalidClass,
} from "@/components/auth/formStyles";
import {
  dangerActionButtonClass,
  dangerPanelClass,
  dangerPanelTitleClass,
  ghostButtonClass,
  panelNoteClass,
} from "@/components/settings/panelStyles";
import { Alert } from "@/components/ui/Alert";
import { WORKSPACE_NAME_MAX_LENGTH } from "@/components/workspace/schema";
import type { WorkspaceSettingsView } from "@/components/workspace/settingsRead";
import { renderErrorMessage } from "@/presentation/errorDisplay";
import { extractSerializedError } from "@/presentation/errorResponse";
import { deleteWorkspaceFn } from "@/routes/workspaces/$workspaceId/settings/-action";

/**
 * P-34 の削除を持つ島（PAGE-p34-001..003）。
 *
 * 要求経路の答えは受理（202）までで、実際の掃除はワーカー面が続ける。
 * 受理と同時にこの文脈は開けなくなるので、受理後は個人の文脈への導線
 * だけを出す（引き継ぎ Cookie はサーバー側の応答が個人へ戻している）。
 *
 * 確認の不一致だけは専用の欄に出す。`CONFIRMATION_MISMATCH` は
 * アカウント削除（メールアドレス）と共有のコードで、辞書の文言はそちら
 * 向けなので、ここでは名前用の文言を当てる。
 */

const MISMATCH_MESSAGE = "ワークスペース名が一致しません。";

type SubmitError = Readonly<{ target: "field" | "panel"; message: string }>;

type SubmitState = Readonly<{ error: SubmitError | null; accepted: boolean }>;

const IDLE: SubmitState = { error: null, accepted: false };

function submitError(error: unknown): SubmitError {
  const serialized = extractSerializedError(error);
  return serialized.code === "CONFIRMATION_MISMATCH"
    ? { target: "field", message: MISMATCH_MESSAGE }
    : { target: "panel", message: renderErrorMessage(serialized) };
}

export function WorkspaceDeletionForm({
  workspace,
}: {
  workspace: WorkspaceSettingsView;
}) {
  const router = useRouter();
  const requestDeletion = useServerFn(deleteWorkspaceFn);

  const confirmId = useId();
  const confirmErrorId = useId();
  const acceptedRef = useRef<HTMLElement | null>(null);

  const [confirmation, setConfirmation] = useState("");
  const readOnly = !workspace.canManage;
  const matches = confirmation.trim() === workspace.name;

  const [state, submit, isSubmitting] = useActionState(
    async (
      _previous: SubmitState,
      formData: FormData,
    ): Promise<SubmitState> => {
      try {
        await requestDeletion({
          data: {
            workspaceId: workspace.workspaceId,
            confirmationName: String(formData.get("confirmationName") ?? ""),
          },
        });
      } catch (error) {
        return { error: submitError(error), accepted: false };
      }
      // 受理は取り消せないので、再整合の失敗を「削除できなかった」と
      // 見せない（try の外に置く）。このワークスペースの断片は既に
      // 開けないので、失敗しても画面は受理表示のままでよい。
      router.invalidate().catch(() => {
        console.error("Workspace deletion reconcile failed");
      });
      return { error: null, accepted: true };
    },
    IDLE,
  );

  // パネルがフォームごと差し替わるので、live region への挿入だけでは
  // 読み上げが落ちる支援技術がある。焦点を移して見出しを確実に読ませる。
  useEffect(() => {
    if (state.accepted) acceptedRef.current?.focus();
  }, [state.accepted]);

  if (state.accepted) {
    return (
      <section
        ref={acceptedRef}
        tabIndex={-1}
        className={`${dangerPanelClass} focus-visible:shadow-none`}
      >
        <h2 className={dangerPanelTitleClass}>
          ワークスペースの削除を受け付けました
        </h2>
        <p className={panelNoteClass}>
          メンバー全員がアクセスできなくなりました。ノート・タグ・公開ページの削除は続いています。この画面を閉じても処理は進みます。
        </p>
        <a className={ghostButtonClass} href="/notes">
          個人のノートへ
        </a>
      </section>
    );
  }

  // 入力中の不一致もその場で言う。実行ボタンは一致するまで押せないので、
  // これが無いと「押せない理由」がどこにも出ない。
  const fieldError =
    state.error?.target === "field"
      ? state.error.message
      : confirmation !== "" && !matches
        ? MISMATCH_MESSAGE
        : null;
  const panelError =
    state.error?.target === "panel" ? state.error.message : null;

  return (
    <>
      {/* 移動先の選択（P-10 の一括操作 / P-11 の移動）は別スライスなので、
          ここでは案内だけを出して導線は置かない。 */}
      <Alert
        tone="warning"
        role="note"
        title="残したいノートは先に移動できます"
      >
        個人や他のワークスペースへ移すと、削除の影響を受けません。移動はノート一覧とノート詳細から行えます。
      </Alert>

      {readOnly ? (
        <Alert tone="info" title="読み取り専用です" role="note">
          ワークスペースを削除できるのは owner だけです。
        </Alert>
      ) : null}

      <section className={dangerPanelClass}>
        <h2 className={dangerPanelTitleClass}>ワークスペースを削除</h2>

        <div className="mb-2 text-xs tracking-[0.06em] text-ink-tertiary uppercase">
          削除されるもの
        </div>
        <ul className="mb-5">
          {[
            "このワークスペースのノートと、その元ファイル",
            "公開ページと、公開・限定公開だったノートの URL",
            "メンバー全員のアクセスと、ワークスペースのタグ",
            "実行中の処理（変換・バックアップ）",
          ].map((item) => (
            <li
              key={item}
              className="flex items-start gap-2 py-1 text-sm text-ink-secondary"
            >
              <span className="mt-[3px] shrink-0 text-error">
                <CrossIcon />
              </span>
              {item}
            </li>
          ))}
        </ul>

        <p className={panelNoteClass}>この操作は取り消せません。</p>

        <form action={submit}>
          <div className="mb-4">
            <label className={fieldLabelClass} htmlFor={confirmId}>
              確認のため、ワークスペース名「{workspace.name}」を入力してください
            </label>
            <input
              className={`${inputClass} ${fieldError === null ? "" : inputInvalidClass}`}
              id={confirmId}
              name="confirmationName"
              type="text"
              autoComplete="off"
              maxLength={WORKSPACE_NAME_MAX_LENGTH}
              value={confirmation}
              disabled={readOnly || isSubmitting}
              aria-invalid={fieldError !== null}
              aria-describedby={confirmErrorId}
              onChange={(event) => setConfirmation(event.target.value)}
            />
            <p
              className={fieldErrorClass}
              id={confirmErrorId}
              aria-live="polite"
            >
              {fieldError}
            </p>
          </div>

          {/* 常設の live region。入力と無関係な失敗はこちらに出す。 */}
          <p
            className={`${fieldErrorClass} not-empty:mb-3`}
            role="status"
            aria-live="polite"
          >
            {panelError}
          </p>

          <button
            type="submit"
            className={dangerActionButtonClass}
            disabled={readOnly || isSubmitting || !matches}
            aria-busy={isSubmitting}
          >
            {isSubmitting ? "受付中..." : "ワークスペースを削除する"}
          </button>
        </form>
      </section>
    </>
  );
}

function CrossIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}
