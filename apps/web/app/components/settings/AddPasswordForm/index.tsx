"use client";

import { useActionState, useEffect, useId, useRef, useState } from "react";
import {
  fieldErrorClass,
  fieldLabelClass,
  inputClass,
  inputInvalidClass,
} from "@/components/auth/formStyles";
import {
  ghostButtonClass,
  primaryButtonClass,
} from "@/components/settings/panelStyles";
import { displayError } from "@/presentation/errorDisplay";

/**
 * PAGE-p22-002 パスワード認証の追加。
 *
 * 送信そのもの（`addPasswordFn` と楽観的なリスト追加）は親の島が所有し、
 * ここは入力と「追加中 / 失敗」の表示だけを持つ — 追加はリストの増減
 * なので、楽観的状態は親にしか置けない（CLAUDE.md 所有権の規則）。
 *
 * ネイティブの `<dialog>` を `showModal()` で開く。フォーカストラップは
 * 要素側の仕様に任せるが、Esc による閉じは送信中だけ塞ぐ — 失敗文言は
 * このダイアログの中にしか無いので、閉じたあとに届くと利用者に読めない
 * （「やめる」を `disabled` にしているのと同じ理由）。
 */
export function AddPasswordForm({
  open,
  onClose,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (newPassword: string) => Promise<void>;
}) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const passwordId = useId();
  const confirmId = useId();
  const confirmErrorId = `${confirmId}-error`;
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) return;
    if (open && !dialog.open) {
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  const [error, formAction, isPending] = useActionState<
    string | null,
    FormData
  >(async () => {
    try {
      await onSubmit(password);
    } catch (thrown) {
      return displayError(thrown);
    }
    setPassword("");
    setConfirmation("");
    return null;
  }, null);

  const mismatch = confirmation.length > 0 && confirmation !== password;

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={`${passwordId}-title`}
      onCancel={(event) => {
        if (isPending) event.preventDefault();
      }}
      onClose={onClose}
      className="m-auto w-[min(28rem,calc(100vw-2rem))] rounded-lg border border-hairline bg-bg p-5 text-ink shadow-md backdrop:bg-ink/25"
    >
      <h2
        id={`${passwordId}-title`}
        className="mb-2 text-md font-semibold tracking-tight"
      >
        パスワードを追加
      </h2>
      <p className="mb-5 text-sm text-ink-secondary">
        追加すると、メールアドレスとパスワードでもサインインできるようになります。
      </p>

      <form action={formAction} noValidate>
        <div className="mb-4">
          <label className={fieldLabelClass} htmlFor={passwordId}>
            新しいパスワード
          </label>
          <input
            id={passwordId}
            type="password"
            autoComplete="new-password"
            required
            value={password}
            disabled={isPending}
            onChange={(event) => setPassword(event.target.value)}
            className={inputClass}
          />
          <p className="mt-2 text-xs text-ink-tertiary">
            8 文字以上で、英字と数字の両方を含めてください。
          </p>
        </div>
        <div className="mb-4">
          <label className={fieldLabelClass} htmlFor={confirmId}>
            もう一度入力
          </label>
          <input
            id={confirmId}
            type="password"
            autoComplete="new-password"
            required
            value={confirmation}
            disabled={isPending}
            onChange={(event) => setConfirmation(event.target.value)}
            aria-invalid={mismatch}
            aria-describedby={confirmErrorId}
            className={`${inputClass} ${mismatch ? inputInvalidClass : ""}`}
          />
          <p id={confirmErrorId} className={fieldErrorClass} aria-live="polite">
            {mismatch ? "2 つのパスワードが一致しません" : null}
          </p>
        </div>

        {/* 常設の live region。失敗文言だけが入れ替わる。 */}
        <p className={fieldErrorClass} role="status" aria-live="polite">
          {error}
        </p>

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            className={ghostButtonClass}
            disabled={isPending}
            onClick={onClose}
          >
            やめる
          </button>
          <button
            type="submit"
            className={primaryButtonClass}
            disabled={
              isPending || password.length === 0 || confirmation !== password
            }
            aria-busy={isPending}
          >
            {isPending ? "追加中..." : "パスワードを追加"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
