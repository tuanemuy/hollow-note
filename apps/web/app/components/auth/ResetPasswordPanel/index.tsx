"use client";

import { Link, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  type ReactNode,
  useActionState,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { renderErrorMessage } from "@/presentation/errorDisplay";
import { extractSerializedError } from "@/presentation/errorResponse";
import { emailFormatError } from "../fieldValidation";
import {
  fieldErrorClass,
  fieldLabelClass,
  footLinkClass,
  inputClass,
  inputInvalidClass,
  submitButtonClass,
} from "../formStyles";
import { PasswordStrengthMeter } from "../PasswordStrengthMeter";
import { passwordStrength } from "../passwordStrength";
import { requestPasswordResetFn, resetPasswordFn } from "./action";

/**
 * P-04 パスワード再設定（spec/pages/index.md#P-04、モック
 * P04-reset-password.html）。`?token=` の有無で申請モード / 実行モードに
 * 分かれ、状態は 入力 / 送信中 / 申請完了 / 実行成功 / トークン無効・
 * 期限切れ の 5 つ（PAGE-p04-001..004）。
 *
 * 申請完了は宛先の状態によらず同一文言にする — 「送った / 送っていない」
 * を出し分けた時点で利用者の存在が漏れる。usecase 側も全経路で同じ空の
 * 成功を返すので、ここに分岐の材料は届かない。
 *
 * トークンが死んでいることは実行して初めて分かる（GET は状態を変えない）
 * ので、無効・期限切れは実行の失敗として受け取り、そこから申請フォームへ
 * 戻す（PAGE-p04-004）。URL からも token を落とすので、再読み込みで
 * 死んだトークンの画面へ戻らない。
 */

type RequestOutcome = Readonly<{ sent: boolean; error: string | null }>;
type ResetOutcome = Readonly<{
  status: "idle" | "done" | "tokenInvalid";
  error: string | null;
}>;

const REQUEST_IDLE: RequestOutcome = { sent: false, error: null };
const RESET_IDLE: ResetOutcome = { status: "idle", error: null };

export function ResetPasswordPanel({ token }: { token: string | null }) {
  const [asking, setAsking] = useState(token === null);

  return asking ? (
    <RequestMode />
  ) : (
    <ResetMode token={token ?? ""} onRestart={() => setAsking(true)} />
  );
}

function RequestMode() {
  const request = useServerFn(requestPasswordResetFn);
  const emailId = useId();
  const emailErrorId = `${emailId}-error`;
  const [email, setEmail] = useState("");
  const [touched, setTouched] = useState(false);

  const formatError = emailFormatError(email);
  const shownFormatError = touched ? formatError : null;

  const [outcome, formAction, isPending] = useActionState<
    RequestOutcome,
    FormData
  >(async () => {
    try {
      await request({ data: { email: email.trim() } });
    } catch (error) {
      return {
        sent: false,
        error: renderErrorMessage(extractSerializedError(error)),
      };
    }
    return { sent: true, error: null };
  }, REQUEST_IDLE);

  if (outcome.sent) {
    return (
      <Result
        icon={<MailIcon className="text-success" />}
        title="メールを送りました"
        body="そのアドレスで登録されていれば、再設定のリンクが届きます。リンクは 1 時間で無効になります。"
        foot={<SignInLink />}
      />
    );
  }

  return (
    <div>
      <h1 className="mb-3 text-center text-xl font-medium tracking-tight leading-snug">
        パスワードを再設定
      </h1>
      <p className="mb-6 text-center text-sm text-ink-secondary">
        登録しているメールアドレスに、再設定のリンクを送ります。
      </p>

      {/* 常設の live region。失敗文言だけが入れ替わる。 */}
      <p className="mb-4 text-sm text-error" role="status" aria-live="polite">
        {outcome.error}
      </p>

      <form action={formAction} noValidate>
        <div className="mb-4">
          <label className={fieldLabelClass} htmlFor={emailId}>
            メールアドレス
          </label>
          <input
            id={emailId}
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
            required
            value={email}
            disabled={isPending}
            onChange={(e) => setEmail(e.target.value)}
            onBlur={() => setTouched(true)}
            aria-invalid={shownFormatError !== null}
            aria-describedby={emailErrorId}
            className={`${inputClass} ${shownFormatError !== null ? inputInvalidClass : ""}`}
          />
          <p id={emailErrorId} className={fieldErrorClass} aria-live="polite">
            {shownFormatError}
          </p>
        </div>
        <button
          type="submit"
          disabled={isPending || formatError !== null}
          className={submitButtonClass}
        >
          {isPending ? "送信中..." : "再設定リンクを送る"}
        </button>
      </form>

      <SignInLink />
    </div>
  );
}

function ResetMode({
  token,
  onRestart,
}: {
  token: string;
  onRestart: () => void;
}) {
  const router = useRouter();
  const submit = useServerFn(resetPasswordFn);
  const passwordId = useId();
  const confirmId = useId();
  const confirmErrorId = `${confirmId}-error`;
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");

  const mismatch = confirmation.length > 0 && confirmation !== password;
  const strength = passwordStrength(password);

  const [outcome, formAction, isPending] = useActionState<
    ResetOutcome,
    FormData
  >(async () => {
    try {
      await submit({ data: { token, newPassword: password } });
    } catch (error) {
      const serialized = extractSerializedError(error);
      // 期限切れ・使用済み・用途違い・世代ずれはすべて「このリンクは
      // もう使えない」に収斂する。残る失敗（強度違反など）はフォームに
      // 留めて直せるようにする。
      if (
        serialized.code === "IDENTITY_TOKEN_EXPIRED" ||
        serialized.code === "AUTH_TOKEN_NOT_FOUND" ||
        serialized.code === "AUTH_TOKEN_ALREADY_CONSUMED"
      ) {
        return { status: "tokenInvalid", error: null };
      }
      return { status: "idle", error: renderErrorMessage(serialized) };
    }
    // 成功時点で自分のセッションも失効しているので、キャッシュ済みの
    // 認証状態を捨てる。ここでの失敗は再設定の失敗ではないので try の外。
    await router.invalidate().catch(() => {
      console.error("Post-reset reconcile failed");
    });
    return { status: "done", error: null };
  }, RESET_IDLE);

  if (outcome.status === "done") {
    return (
      <Result
        icon={<CheckIcon className="text-success" />}
        title="パスワードを設定しました"
        body="すべての端末のサインインを解除しました。新しいパスワードでサインインしてください。"
        actions={
          <Link to="/signin" className={primaryLinkClass}>
            サインインへ
          </Link>
        }
      />
    );
  }

  if (outcome.status === "tokenInvalid") {
    return (
      <Result
        icon={<ClockIcon className="text-warning" />}
        title="この再設定リンクは使えません"
        body="期限が切れているか、すでに使われています。もう一度申請してください。"
        actions={
          <button
            type="button"
            className={outlineButtonClass}
            onClick={() => {
              onRestart();
              // 死んだトークンを URL から落として、再読み込みでこの画面へ
              // 戻らないようにする。
              void router.navigate({ to: "/reset-password" }).catch(() => {
                console.error("Navigation back to the request form failed");
              });
            }}
          >
            再設定を申請し直す
          </button>
        }
      />
    );
  }

  return (
    <div>
      <h1 className="mb-3 text-center text-xl font-medium tracking-tight leading-snug">
        新しいパスワード
      </h1>
      <p className="mb-6 text-center text-sm text-ink-secondary">
        設定すると、すべての端末のサインインが解除されます。
      </p>

      <p className="mb-4 text-sm text-error" role="status" aria-live="polite">
        {outcome.error}
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
            onChange={(e) => setPassword(e.target.value)}
            className={inputClass}
          />
          {password.length > 0 ? (
            <PasswordStrengthMeter strength={strength} />
          ) : null}
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
            onChange={(e) => setConfirmation(e.target.value)}
            aria-invalid={mismatch}
            aria-describedby={confirmErrorId}
            className={`${inputClass} ${mismatch ? inputInvalidClass : ""}`}
          />
          <p id={confirmErrorId} className={fieldErrorClass} aria-live="polite">
            {mismatch ? "2 つのパスワードが一致しません" : null}
          </p>
        </div>
        <button
          type="submit"
          disabled={
            isPending ||
            password.length === 0 ||
            confirmation !== password ||
            strength.score === 0
          }
          className={submitButtonClass}
        >
          {isPending ? "設定中..." : "パスワードを設定"}
        </button>
      </form>
    </div>
  );
}

function SignInLink() {
  return (
    <p className="mt-6 text-center text-sm text-ink-secondary">
      <Link to="/signin" className={footLinkClass}>
        サインインに戻る
      </Link>
    </p>
  );
}

function Result({
  icon,
  title,
  body,
  actions,
  foot,
}: {
  icon: ReactNode;
  title: string;
  body: string;
  actions?: ReactNode;
  foot?: ReactNode;
}) {
  const ref = useRef<HTMLDivElement | null>(null);

  // 結果はフォームごと差し替わるので、live region への挿入だけでは
  // 読み上げが落ちる支援技術がある。送信という操作の直後なので、焦点も
  // ここへ移して見出しを確実に読ませる。
  useEffect(() => {
    ref.current?.focus();
  }, []);

  return (
    <div
      ref={ref}
      tabIndex={-1}
      role="status"
      aria-live="polite"
      className="text-center focus-visible:shadow-none"
    >
      <span className="mb-5 inline-flex">{icon}</span>
      <h1 className="mb-3 text-xl font-medium tracking-tight leading-snug">
        {title}
      </h1>
      <p className="mb-6 text-sm text-ink-secondary">{body}</p>
      {actions !== undefined ? (
        <div className="flex flex-wrap justify-center gap-2">{actions}</div>
      ) : null}
      {foot}
    </div>
  );
}

const primaryLinkClass =
  "inline-flex h-10 items-center justify-center rounded-pill bg-accent px-5 text-sm font-medium text-bg transition-colors hover:bg-accent-hover active:bg-accent-pressed";

const outlineButtonClass =
  "inline-flex h-10 items-center justify-center rounded-pill border border-hairline-strong bg-bg px-5 text-sm font-medium text-ink transition-colors hover:bg-surface";

function MailIcon({ className }: { className?: string }) {
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
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <polyline points="22 6 12 13 2 6" />
    </svg>
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
