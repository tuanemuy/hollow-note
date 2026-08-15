"use client";

import { useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useActionState, useId, useState } from "react";
import {
  fieldErrorClass,
  fieldLabelClass,
  inputClass,
  inputInvalidClass,
} from "@/components/auth/formStyles";
import { PasswordStrengthMeter } from "@/components/auth/PasswordStrengthMeter";
import { passwordStrength } from "@/components/auth/passwordStrength";
import {
  panelClass,
  panelNoteClass,
  panelTitleClass,
  primaryButtonClass,
} from "@/components/settings/panelStyles";
import { displayError } from "@/presentation/errorDisplay";
import { changePasswordFn } from "@/routes/settings/-action";

/**
 * PAGE-p22-003 パスワードの変更（モック P22-settings-auth.html の
 * 「パスワードを変更」パネル）。
 *
 * リストの増減を起こさない葉なので、server function・pending・エラー
 * 表示を自分で持つ（CLAUDE.md 所有権の規則）。現在のセッション
 * トークンは Cookie から server function が読むので、ここでは扱わない。
 */

type Outcome = Readonly<{ done: boolean; error: string | null }>;

const IDLE: Outcome = { done: false, error: null };

export function ChangePasswordForm() {
  const router = useRouter();
  const change = useServerFn(changePasswordFn);
  const currentId = useId();
  const passwordId = useId();
  const confirmId = useId();
  const confirmErrorId = `${confirmId}-error`;
  const [current, setCurrent] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");

  const mismatch = confirmation.length > 0 && confirmation !== password;
  const strength = passwordStrength(password);

  const [outcome, formAction, isPending] = useActionState<Outcome, FormData>(
    async () => {
      try {
        await change({
          data: { currentPassword: current, newPassword: password },
        });
      } catch (error) {
        return { done: false, error: displayError(error) };
      }
      setCurrent("");
      setPassword("");
      setConfirmation("");
      await router.invalidate().catch(() => {
        console.error("Password change reconcile failed");
      });
      return { done: true, error: null };
    },
    IDLE,
  );

  return (
    <section className={panelClass}>
      <h2 className={panelTitleClass}>パスワードを変更</h2>
      <p className={panelNoteClass}>
        変更しても、この端末のサインインは維持されます。他の端末はすべてサインアウトされます。
      </p>

      <form action={formAction} noValidate>
        <div className="mb-5">
          <label className={fieldLabelClass} htmlFor={currentId}>
            現在のパスワード
          </label>
          <input
            id={currentId}
            type="password"
            autoComplete="current-password"
            required
            value={current}
            disabled={isPending}
            onChange={(event) => setCurrent(event.target.value)}
            className={inputClass}
          />
        </div>
        <div className="mb-5">
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
          {password.length > 0 ? (
            <PasswordStrengthMeter strength={strength} />
          ) : null}
        </div>
        <div className="mb-5">
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

        {/* 常設の live region。成功・失敗の文言だけが入れ替わる。 */}
        <p className={fieldErrorClass} role="status" aria-live="polite">
          {outcome.error}
        </p>
        <p className="text-xs text-success not-empty:mb-2" aria-live="polite">
          {outcome.done
            ? "パスワードを変更しました。他の端末はサインアウトされています。"
            : null}
        </p>

        <button
          type="submit"
          className={primaryButtonClass}
          aria-busy={isPending}
          disabled={
            isPending ||
            current.length === 0 ||
            password.length === 0 ||
            confirmation !== password ||
            strength.score === 0
          }
        >
          {isPending ? "変更中..." : "パスワードを変更"}
        </button>
      </form>
    </section>
  );
}
