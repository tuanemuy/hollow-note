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
 *
 * 失敗後の画面は単一の `Phase` 直和で持ち、throttled / locked の残り時間
 * は deadline からの導出にする。サーバー側の判定が正で、この時間は
 * あくまで案内 — 早すぎる再送信は再び 429 になるだけなので、deadline を
 * 復元できないときは秒数を発明せず、入力も塞がない。
 */

type Phase =
  | { kind: "idle" }
  | { kind: "throttled"; until: Date | null }
  | { kind: "locked"; unlockAt: Date | null }
  | { kind: "invalidCredentials" }
  | { kind: "emailNotVerified" }
  | { kind: "accountDeleting" }
  | { kind: "generic"; error: SerializedError };

function firstField(error: SerializedError, name: string): string | null {
  if (error.kind !== "validation" || error.fieldErrors === undefined) {
    return null;
  }
  const values = error.fieldErrors[name];
  return values !== undefined && values.length > 0 ? (values[0] ?? null) : null;
}

function classify(error: SerializedError): Phase {
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
        return {
          kind: "throttled",
          until:
            Number.isFinite(parsed) && parsed > 0
              ? new Date(Date.now() + parsed * 1000)
              : null,
        };
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

function remainingSeconds(deadline: Date, now: number): number {
  return Math.max(0, Math.ceil((deadline.getTime() - now) / 1000));
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
  const [now, setNow] = useState(() => Date.now());

  const [state, formAction, isPending] = useActionState<
    { phase: Phase },
    FormData
  >(
    async () => {
      try {
        await signIn({ data: { email, password } });
        // Drop every cached match before leaving: the router instance
        // survives sign-in, so under `staleTime: Infinity` a previous
        // session's RSC payloads would otherwise still be served fresh.
        await router.invalidate();
        // `redirectTo` is a validated same-origin path but not a typed
        // route id, so it goes through the history API.
        router.history.push(redirectTo);
        return { phase: { kind: "idle" } };
      } catch (error) {
        return { phase: classify(extractSerializedError(error)) };
      }
    },
    { phase: { kind: "idle" } },
  );

  const phase = state.phase;
  // The deadline the current phase is waiting out, if it has one. Both
  // countdown and re-enabling are derived from it — no mirrored counter
  // state that could disagree with the alert being shown.
  const deadline =
    phase.kind === "throttled"
      ? phase.until
      : phase.kind === "locked"
        ? phase.unlockAt
        : null;
  const waiting = deadline !== null && deadline.getTime() > now;

  useEffect(() => {
    if (deadline === null || deadline.getTime() <= now) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [deadline, now]);

  const disabled = isPending || waiting;

  return (
    <div>
      <h1 className="mb-8 text-center text-2xl font-normal tracking-tightest leading-snug">
        サインイン
      </h1>

      <PhaseAlert phase={phase} now={now} waiting={waiting} />

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

function PhaseAlert({
  phase,
  now,
  waiting,
}: {
  phase: Phase;
  now: number;
  waiting: boolean;
}) {
  switch (phase.kind) {
    case "idle":
      return null;
    case "throttled":
      // A known deadline that has passed means the wait is over — the
      // inputs are re-enabled, so the alert has nothing left to say.
      if (phase.until !== null && !waiting) return null;
      return (
        <Alert tone="warning" title="しばらく待ってからお試しください">
          {phase.until !== null
            ? `続けて失敗したため、あと ${remainingSeconds(phase.until, now)} 秒はサインインを受け付けられません。`
            : "続けて失敗したため、サインインを一時的に受け付けられません。少し待ってからもう一度お試しください。"}
        </Alert>
      );
    case "locked":
      return (
        <Alert tone="error" title="サインインを一時的に停止しました">
          {phase.unlockAt !== null
            ? `失敗が続いたため ${unlockTimeFormat.format(phase.unlockAt)} まで停止しています。`
            : "失敗が続いたため一時的に停止しています。"}
          パスワードを再設定すると、待たずに使えるようになります。
        </Alert>
      );
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
    case "generic":
      return (
        <Alert tone="error" title="サインインできませんでした">
          {displayError(phase.error)}
        </Alert>
      );
  }
}
