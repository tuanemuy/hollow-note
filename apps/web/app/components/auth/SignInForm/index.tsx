"use client";

import { Link, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useActionState, useEffect, useId, useState } from "react";
import { Alert } from "@/components/ui/Alert";
import { displayError } from "@/presentation/errorDisplay";
import {
  extractSerializedError,
  type SerializedError,
} from "@/presentation/errorResponse";
import {
  fieldLabelClass,
  footLinkClass,
  inputClass,
  submitButtonClass,
} from "../formStyles";
import { signInFn } from "./action";

/**
 * P-02 サインイン（spec/pages/index.md#P-02、モック P02-signin.html）。
 * 状態: 入力 / 認証失敗（共通文言）/ 未確認 / 待機中（THROTTLED、残秒を
 * 数えて再開）/ ロック中（LOCKED、解除時刻 + 再設定の文言のみ — P-04 は
 * 本スライス外）/ 送信中。Google・再送・再設定導線は出さない。
 */

type Rejection =
  | { kind: "invalidCredentials" }
  | { kind: "emailNotVerified" }
  | { kind: "accountDeleting" }
  | { kind: "locked"; unlockAt: Date | null }
  | { kind: "generic"; error: SerializedError };

type FormState = { rejection: Rejection | null };

function firstField(error: SerializedError, name: string): string | null {
  if (error.kind !== "validation" || error.fieldErrors === undefined) {
    return null;
  }
  const values = error.fieldErrors[name];
  return values !== undefined && values.length > 0 ? (values[0] ?? null) : null;
}

function classify(error: SerializedError): Rejection | { waitSeconds: number } {
  if (error.kind === "validation") {
    switch (error.code) {
      case "INVALID_CREDENTIALS":
        return { kind: "invalidCredentials" };
      case "EMAIL_NOT_VERIFIED":
        return { kind: "emailNotVerified" };
      case "ACCOUNT_DELETING":
        return { kind: "accountDeleting" };
      case "THROTTLED": {
        const raw = firstField(error, "waitSeconds");
        const parsed = raw !== null ? Number.parseInt(raw, 10) : Number.NaN;
        return { waitSeconds: Number.isFinite(parsed) ? parsed : 60 };
      }
      case "LOCKED": {
        const raw = firstField(error, "unlockAt");
        const parsed = raw !== null ? new Date(raw) : null;
        return {
          kind: "locked",
          unlockAt:
            parsed !== null && !Number.isNaN(parsed.getTime()) ? parsed : null,
        };
      }
    }
  }
  return { kind: "generic", error };
}

const unlockTimeFormat = new Intl.DateTimeFormat("ja-JP", {
  month: "long",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

export function SignInForm({ redirectTo }: { redirectTo: string }) {
  const router = useRouter();
  const signIn = useServerFn(signInFn);
  const emailId = useId();
  const passwordId = useId();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [waitSeconds, setWaitSeconds] = useState(0);

  // THROTTLED の残秒。0 になったら入力を再開する（サーバー側の判定が
  // 正で、この数はあくまで案内 — 早すぎる再送信は再び 429 になるだけ）。
  useEffect(() => {
    if (waitSeconds <= 0) return;
    const timer = setInterval(() => {
      setWaitSeconds((current) => (current > 1 ? current - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, [waitSeconds]);

  const [state, formAction, isPending] = useActionState<FormState, FormData>(
    async () => {
      try {
        await signIn({ data: { email, password } });
        // `redirectTo` is a validated same-origin path but not a typed
        // route id, so it goes through the history API.
        router.history.push(redirectTo);
        return { rejection: null };
      } catch (error) {
        const outcome = classify(extractSerializedError(error));
        if ("waitSeconds" in outcome) {
          setWaitSeconds(outcome.waitSeconds);
          return { rejection: null };
        }
        return { rejection: outcome };
      }
    },
    { rejection: null },
  );

  const throttled = waitSeconds > 0;
  const locked = state.rejection?.kind === "locked";
  const disabled = isPending || throttled || locked;

  return (
    <div>
      <h1 className="mb-8 text-center text-2xl font-normal tracking-tightest leading-snug">
        サインイン
      </h1>

      {throttled ? (
        <Alert tone="warning" title="しばらく待ってからお試しください">
          続けて失敗したため、あと {waitSeconds}{" "}
          秒はサインインを受け付けられません。
        </Alert>
      ) : null}
      {state.rejection !== null && !throttled ? (
        <RejectionAlert rejection={state.rejection} />
      ) : null}

      <form action={formAction} noValidate>
        <div className="mb-4">
          <label className={fieldLabelClass} htmlFor={emailId}>
            メールアドレス
          </label>
          <input
            id={emailId}
            type="email"
            autoComplete="email"
            required
            value={email}
            disabled={disabled}
            onChange={(e) => setEmail(e.target.value)}
            className={inputClass}
          />
        </div>
        <div className="mb-4">
          <label className={fieldLabelClass} htmlFor={passwordId}>
            パスワード
          </label>
          <input
            id={passwordId}
            type="password"
            autoComplete="current-password"
            required
            value={password}
            disabled={disabled}
            onChange={(e) => setPassword(e.target.value)}
            className={inputClass}
          />
        </div>
        <button
          type="submit"
          disabled={disabled || email.length === 0 || password.length === 0}
          className={`${submitButtonClass} mt-2`}
        >
          {isPending ? "サインイン中..." : "サインイン"}
        </button>
      </form>

      <p className="mt-8 text-center text-sm text-ink-secondary">
        アカウントがまだですか？{" "}
        <Link to="/signup" className={footLinkClass}>
          アカウントを作る
        </Link>
      </p>
    </div>
  );
}

function RejectionAlert({ rejection }: { rejection: Rejection }) {
  switch (rejection.kind) {
    case "invalidCredentials":
      return (
        <Alert tone="error" title="メールアドレスかパスワードが違います">
          入力内容を確認してもう一度お試しください。
        </Alert>
      );
    case "emailNotVerified":
      return (
        <Alert tone="warning" title="メールアドレスの確認が済んでいません">
          登録時に送った確認メールのリンクを開いてください。
        </Alert>
      );
    case "accountDeleting":
      return (
        <Alert tone="error" title="このアカウントは削除処理中です">
          削除の処理が完了するまでサインインできません。
        </Alert>
      );
    case "locked":
      return (
        <Alert tone="error" title="サインインを一時的に停止しました">
          {rejection.unlockAt !== null
            ? `失敗が続いたため ${unlockTimeFormat.format(rejection.unlockAt)} まで停止しています。`
            : "失敗が続いたため一時的に停止しています。"}
          パスワードを再設定すると、待たずに使えるようになります。
        </Alert>
      );
    case "generic":
      return (
        <Alert tone="error" title="サインインできませんでした">
          {displayError(rejection.error)}
        </Alert>
      );
  }
}
