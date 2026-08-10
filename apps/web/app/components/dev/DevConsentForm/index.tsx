"use client";

import { useServerFn } from "@tanstack/react-start";
import { useActionState, useId, useState } from "react";
import {
  fieldLabelClass,
  inputClass,
  submitButtonClass,
} from "@/components/auth/formStyles";
import { Alert } from "@/components/ui/Alert";
import { displayError } from "@/presentation/errorDisplay";
import { submitDevConsentFn } from "@/routes/dev/-action";

/**
 * dev IdP の同意画面（ADR-021）。Google の同意画面が担う「アカウントを
 * 選ぶ / 許可する / キャンセルする」をローカルで再現するためだけの画面で、
 * `OAUTH_DEV_MODE` が真のときしか到達しない。
 *
 * 許可・キャンセルのどちらも遷移先はサーバーが決める（`redirect_uri` の
 * 同一オリジン検査をクライアントに任せない）。復帰はフル遷移で行う —
 * 実プロバイダーからの戻りと同じ経路をコールバック画面に踏ませたい。
 */
export function DevConsentForm({
  redirectUri,
  state,
  codeChallenge,
}: {
  redirectUri: string;
  state: string;
  codeChallenge: string;
}) {
  const submit = useServerFn(submitDevConsentFn);
  const emailId = useId();
  const displayNameId = useId();
  const verifiedId = useId();
  const [email, setEmail] = useState("dev-user@example.com");
  const [displayName, setDisplayName] = useState("Dev User");
  const [emailVerified, setEmailVerified] = useState(true);

  const [error, formAction, isPending] = useActionState<
    string | null,
    FormData
  >(async (_previous, formData) => {
    const decision = formData.get("decision") === "deny" ? "deny" : "approve";
    try {
      const { location } = await submit({
        data: {
          redirectUri,
          state,
          codeChallenge,
          decision,
          email,
          displayName,
          emailVerified,
        },
      });
      // Full transition, exactly like the return leg from a real IdP.
      window.location.assign(location);
    } catch (cause) {
      return displayError(cause);
    }
    return null;
  }, null);

  return (
    <div>
      <h1 className="mb-2 text-center text-2xl font-normal tracking-tightest leading-snug">
        開発用 ID プロバイダー
      </h1>
      <p className="mb-8 text-center text-sm text-ink-secondary">
        Hollow がアカウント情報の参照を求めています。
      </p>

      <div role="status" aria-live="polite">
        {error !== null ? (
          <Alert tone="error" title="続行できませんでした" role="note">
            {error}
          </Alert>
        ) : null}
      </div>

      <form action={formAction} noValidate>
        <div className="mb-4">
          <label className={fieldLabelClass} htmlFor={emailId}>
            メールアドレス
          </label>
          <input
            id={emailId}
            name="email"
            type="email"
            autoComplete="off"
            required
            value={email}
            disabled={isPending}
            onChange={(e) => setEmail(e.target.value)}
            className={inputClass}
          />
        </div>
        <div className="mb-4">
          <label className={fieldLabelClass} htmlFor={displayNameId}>
            表示名
          </label>
          <input
            id={displayNameId}
            name="displayName"
            type="text"
            autoComplete="off"
            value={displayName}
            disabled={isPending}
            onChange={(e) => setDisplayName(e.target.value)}
            className={inputClass}
          />
        </div>
        <div className="mb-6 flex items-center gap-2">
          <input
            id={verifiedId}
            type="checkbox"
            checked={emailVerified}
            disabled={isPending}
            onChange={(e) => setEmailVerified(e.target.checked)}
            className="size-4 accent-[var(--color-accent)]"
          />
          <label htmlFor={verifiedId} className="text-sm">
            メールアドレスは確認済み（`email_verified`）
          </label>
        </div>

        <button
          type="submit"
          name="decision"
          value="approve"
          disabled={isPending || email.trim().length === 0}
          className={submitButtonClass}
        >
          {isPending ? "処理中..." : "許可する"}
        </button>
        <button
          type="submit"
          name="decision"
          value="deny"
          disabled={isPending}
          className="mt-3 inline-flex h-11 w-full items-center justify-center rounded-pill border border-hairline-strong bg-bg text-sm font-medium text-ink transition-colors hover:bg-surface disabled:cursor-not-allowed disabled:opacity-55"
        >
          キャンセル
        </button>
      </form>
    </div>
  );
}
