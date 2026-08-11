"use client";

import { Link, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { renderErrorMessage } from "@/presentation/errorDisplay";
import { extractSerializedError } from "@/presentation/errorResponse";
import { footLinkClass } from "../formStyles";
import { ResendVerificationForm } from "../ResendVerificationForm";
import { verifyEmailFn } from "./action";

/**
 * P-03 メール確認（spec/pages/index.md#P-03、モック P03-verify-email.html）。
 * GET は「処理中」を描画するだけで、マウント後にトークンを POST して消費
 * する（spec/adr/029）。状態: 処理中 / 成功（/notes へ遷移）/ 確認済み・サイン
 * インが必要 / 期限切れ / 使用済み（サインインへ）/ 無効 / 一時障害。
 * 期限切れ・無効からは確認メールを再送できる（PAGE-p03-003）。リンク
 * からの来訪でアドレスは分からないので、再送フォームが自分で受け取る。
 *
 * `verifiedSignInRequired` は「確認は成立したがセッションは出なかった」
 * 状態（spec/adr/029）。別端末でリンクを開いた正当な利用者がここへ落ちる。
 * `alreadyVerified`（トークンが使用済み）とは原因が違うので別状態にする。
 */

type Phase =
  | { kind: "processing" }
  | { kind: "succeeded" }
  | { kind: "verifiedSignInRequired" }
  | { kind: "alreadyVerified" }
  | { kind: "expired" }
  | { kind: "invalid" }
  | { kind: "failed"; message: string };

export function VerifyEmailPanel({ token }: { token: string | null }) {
  const router = useRouter();
  const verify = useServerFn(verifyEmailFn);
  const [phase, setPhase] = useState<Phase>(
    token === null ? { kind: "invalid" } : { kind: "processing" },
  );
  const [attempt, setAttempt] = useState(0);
  // One POST per `attempt`, so neither StrictMode's double-invoked effect
  // nor an unstable `verify` identity can consume the one-shot token
  // twice. Only `retry` advances the counter.
  const started = useRef(-1);

  useEffect(() => {
    if (token === null || started.current === attempt) return;
    started.current = attempt;
    void (async () => {
      let result: { signedIn: boolean; alreadyVerified: boolean };
      try {
        result = await verify({ data: { token } });
      } catch (error) {
        const serialized = extractSerializedError(error);
        if (
          serialized.kind === "business" &&
          serialized.code === "IDENTITY_TOKEN_EXPIRED"
        ) {
          setPhase({ kind: "expired" });
        } else if (
          serialized.kind === "system" ||
          serialized.kind === "unknown"
        ) {
          // A transient outage says nothing about the link — telling the
          // visitor it is broken would send them off asking for a resend.
          setPhase({ kind: "failed", message: renderErrorMessage(serialized) });
        } else {
          setPhase({ kind: "invalid" });
        }
        return;
      }
      if (!result.signedIn) {
        setPhase(
          result.alreadyVerified
            ? { kind: "alreadyVerified" }
            : { kind: "verifiedSignInRequired" },
        );
        return;
      }
      setPhase({ kind: "succeeded" });
      // Verification issues a session cookie, so this is an auth-state
      // change like sign-in and reconciles the same way. Both steps sit
      // outside the try: the confirmation already succeeded.
      await router.invalidate().catch(() => {
        console.error("Post-verification reconcile failed");
      });
      await router.navigate({ to: "/notes" }).catch(() => {
        console.error("Navigation after verification failed");
      });
    })();
  }, [token, verify, router, attempt]);

  const retry = useCallback(() => {
    setPhase({ kind: "processing" });
    setAttempt((value) => value + 1);
  }, []);

  // The whole flow is an automatic POST with no user action, so a live
  // region is the only cue assistive technology gets. It must be mounted
  // BEFORE the outcome arrives and stay mounted across phases — swapping
  // content inside a persistent region is what makes it announce.
  return (
    <div role="status" aria-live="polite">
      <PhaseResult phase={phase} onRetry={retry} />
    </div>
  );
}

function PhaseResult({
  phase,
  onRetry,
}: {
  phase: Phase;
  onRetry: () => void;
}) {
  switch (phase.kind) {
    case "processing":
      return (
        <Result
          icon={<Spinner />}
          title="メールアドレスを確認しています"
          body="数秒で終わります。"
        />
      );
    case "succeeded":
      return (
        <Result
          icon={<CheckIcon className="text-success" />}
          title="確認できました"
          body="メールアドレスが確認されました。そのまま使い始められます。"
          actions={<PrimaryLink to="/notes">Hollow を開く</PrimaryLink>}
        />
      );
    case "verifiedSignInRequired":
      return (
        <Result
          icon={<CheckIcon className="text-success" />}
          title="メールアドレスを確認しました"
          body="サインインすると使い始められます。"
          actions={<PrimaryLink to="/signin">サインインへ</PrimaryLink>}
        />
      );
    case "alreadyVerified":
      return (
        <Result
          icon={<CheckIcon className="text-ink-tertiary" />}
          title="このメールアドレスは確認済みです"
          body="すでに確認が完了しています。そのままサインインしてください。"
          actions={<PrimaryLink to="/signin">サインインへ</PrimaryLink>}
        />
      );
    case "expired":
      return (
        <Result
          icon={<ClockIcon className="text-warning" />}
          title="この確認リンクは期限が切れています"
          body="確認メールは 24 時間で無効になります。新しいリンクを送り直せます。"
          actions={<ResendActions variant="primary" />}
        />
      );
    case "invalid":
      return (
        <Result
          icon={<CrossIcon className="text-error" />}
          title="このリンクは使えません"
          body="リンクが途中で切れているか、書き換えられている可能性があります。メールのリンクをもう一度開くか、確認メールを送り直してください。"
          actions={<ResendActions variant="outline" />}
        />
      );
    case "failed":
      return (
        <Result
          icon={<AlertIcon className="text-warning" />}
          title="確認を完了できませんでした"
          body={phase.message}
          actions={
            <button type="button" onClick={onRetry} className={primaryClass}>
              もう一度試す
            </button>
          }
        />
      );
  }
}

/**
 * 再送フォームはメールアドレス欄を伴うので、横並びのボタン列ではなく
 * 1 列に積む。サインイン導線は「再送はしない」利用者の逃げ道として
 * 下に残す。
 */
function ResendActions({ variant }: { variant: "primary" | "outline" }) {
  return (
    <div className="w-full max-w-xs text-center">
      <ResendVerificationForm email={null} variant={variant} />
      <p className="mt-4 text-sm text-ink-secondary">
        <Link to="/signin" className={footLinkClass}>
          サインインへ
        </Link>
      </p>
    </div>
  );
}

function Result({
  icon,
  title,
  body,
  actions,
}: {
  icon: ReactNode;
  title: string;
  body: string;
  actions?: ReactNode;
}) {
  return (
    <div className="text-center">
      <span className="mb-5 inline-flex">{icon}</span>
      <h1 className="mb-3 text-xl font-medium tracking-tight leading-snug">
        {title}
      </h1>
      <p className="mb-6 text-sm text-ink-secondary">{body}</p>
      {actions !== undefined ? (
        <div className="flex flex-wrap justify-center gap-2">{actions}</div>
      ) : null}
    </div>
  );
}

const primaryClass =
  "inline-flex h-10 items-center justify-center rounded-pill bg-accent px-5 text-sm font-medium text-bg transition-colors hover:bg-accent-hover active:bg-accent-pressed";

function PrimaryLink({
  to,
  children,
}: {
  to: "/notes" | "/signin";
  children: ReactNode;
}) {
  return (
    <Link to={to} className={primaryClass}>
      {children}
    </Link>
  );
}

function Spinner() {
  return (
    <span
      aria-hidden="true"
      className="size-7 animate-spin rounded-full border-2 border-accent border-t-transparent motion-reduce:animate-none"
    />
  );
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg
      width="28"
      height="28"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <circle cx="12" cy="12" r="10" />
      <polyline points="16 9.5 10.8 15 8 12.3" />
    </svg>
  );
}

function ClockIcon({ className }: { className?: string }) {
  return (
    <svg
      width="28"
      height="28"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}

function AlertIcon({ className }: { className?: string }) {
  return (
    <svg
      width="28"
      height="28"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="7.5" x2="12" y2="13" />
      <line x1="12" y1="16.5" x2="12" y2="16.5" />
    </svg>
  );
}

function CrossIcon({ className }: { className?: string }) {
  return (
    <svg
      width="28"
      height="28"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <circle cx="12" cy="12" r="10" />
      <line x1="15" y1="9" x2="9" y2="15" />
      <line x1="9" y1="9" x2="15" y2="15" />
    </svg>
  );
}
