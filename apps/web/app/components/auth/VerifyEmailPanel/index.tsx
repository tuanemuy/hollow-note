"use client";

import { Link, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { extractSerializedError } from "@/presentation/errorResponse";
import { footLinkClass } from "../formStyles";
import { verifyEmailFn } from "./action";

/**
 * P-03 メール確認（spec/pages/index.md#P-03、モック P03-verify-email.html）。
 * GET は「処理中」を描画するだけで、マウント後にトークンを POST して消費
 * する（ADR-007）。状態: 処理中 / 成功（/notes へ遷移）/ 期限切れ /
 * 使用済み（サインインへ）/ 無効。再送導線は resendVerificationEmail が
 * 本スライス外のため出さない。
 */

type Phase =
  | { kind: "processing" }
  | { kind: "succeeded" }
  | { kind: "alreadyVerified" }
  | { kind: "expired" }
  | { kind: "invalid" };

export function VerifyEmailPanel({ token }: { token: string | null }) {
  const router = useRouter();
  const verify = useServerFn(verifyEmailFn);
  const [phase, setPhase] = useState<Phase>(
    token === null ? { kind: "invalid" } : { kind: "processing" },
  );
  const started = useRef(false);

  useEffect(() => {
    if (token === null || started.current) return;
    started.current = true;
    void (async () => {
      let signedIn: boolean;
      try {
        signedIn = (await verify({ data: { token } })).signedIn;
      } catch (error) {
        const serialized = extractSerializedError(error);
        setPhase(
          serialized.kind === "business" &&
            serialized.code === "IDENTITY_TOKEN_EXPIRED"
            ? { kind: "expired" }
            : { kind: "invalid" },
        );
        return;
      }
      if (!signedIn) {
        setPhase({ kind: "alreadyVerified" });
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
  }, [token, verify, router]);

  // The whole flow is an automatic POST with no user action, so a live
  // region is the only cue assistive technology gets. It must be mounted
  // BEFORE the outcome arrives and stay mounted across phases — swapping
  // content inside a persistent region is what makes it announce.
  return (
    <div role="status" aria-live="polite">
      <PhaseResult phase={phase} />
    </div>
  );
}

function PhaseResult({ phase }: { phase: Phase }) {
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
          body="確認メールは 24 時間で無効になります。もう一度サインアップすると、案内が届きます。"
          actions={
            <p className="text-sm text-ink-secondary">
              <Link to="/signup" className={footLinkClass}>
                サインアップへ
              </Link>
            </p>
          }
        />
      );
    case "invalid":
      return (
        <Result
          icon={<CrossIcon className="text-error" />}
          title="このリンクは使えません"
          body="リンクが途中で切れているか、書き換えられている可能性があります。メールのリンクをもう一度開いてください。"
          actions={
            <p className="text-sm text-ink-secondary">
              <Link to="/signin" className={footLinkClass}>
                サインインへ
              </Link>
            </p>
          }
        />
      );
  }
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

function PrimaryLink({
  to,
  children,
}: {
  to: "/notes" | "/signin";
  children: ReactNode;
}) {
  return (
    <Link
      to={to}
      className="inline-flex h-10 items-center justify-center rounded-pill bg-accent px-5 text-sm font-medium text-bg transition-colors hover:bg-accent-hover active:bg-accent-pressed"
    >
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
