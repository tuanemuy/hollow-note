"use client";

import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useActionState, useEffect, useId, useRef, useState } from "react";
import { Alert } from "@/components/ui/Alert";
import { displayError } from "@/presentation/errorDisplay";
import {
  extractSerializedError,
  type SerializedError,
} from "@/presentation/errorResponse";
import { emailFormatError } from "../fieldValidation";
import {
  fieldErrorClass,
  fieldLabelClass,
  footLinkClass,
  inputClass,
  inputInvalidClass,
  submitButtonClass,
} from "../formStyles";
import { OAuthButton } from "../OAuthButton";
import {
  DISPLAY_NAME_MAX_LENGTH,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
} from "../schema";
import { signUpFn } from "./action";

/**
 * P-01 サインアップ（spec/pages/index.md#P-01、モック P01-signup.html）。
 * 状態: 入力 / 項目エラー（入力中に検出し送信を抑止）/ 送信中 / 送信完了 /
 * 全体エラー。Google・招待経由は本スライス外のため出さない。
 */

type Fields = Readonly<{
  email: string;
  password: string;
  displayName: string;
  termsAccepted: boolean;
}>;

const initialFields: Fields = {
  email: "",
  password: "",
  displayName: "",
  termsAccepted: false,
};

function passwordError(value: string): string | null {
  if (value.length === 0) return "パスワードを入力してください";
  if (value.length < PASSWORD_MIN_LENGTH) {
    return `パスワードが短すぎます。${PASSWORD_MIN_LENGTH} 文字以上で入力してください`;
  }
  if (value.length > PASSWORD_MAX_LENGTH) {
    return `パスワードは ${PASSWORD_MAX_LENGTH} 文字までです`;
  }
  if (!/[a-zA-Z]/.test(value) || !/[0-9]/.test(value)) {
    return "英字と数字の両方を含めてください";
  }
  return null;
}

function displayNameError(value: string): string | null {
  if (value.trim().length === 0) return "表示名を入力してください";
  if (value.trim().length > DISPLAY_NAME_MAX_LENGTH) {
    return `表示名は ${DISPLAY_NAME_MAX_LENGTH} 文字までです`;
  }
  return null;
}

function passwordStrength(value: string): { score: number; label: string } {
  if (value.length === 0) return { score: 0, label: "" };
  let score = 0;
  if (value.length >= PASSWORD_MIN_LENGTH) score += 1;
  if (/[a-zA-Z]/.test(value) && /[0-9]/.test(value)) score += 1;
  if (value.length >= 12) score += 1;
  if (/[A-Z]/.test(value) && /[a-z]/.test(value)) score += 1;
  else if (/[^a-zA-Z0-9]/.test(value)) score += 1;
  const label = score <= 1 ? "弱い" : score <= 2 ? "普通" : "強い";
  return { score: Math.max(score, 1), label };
}

type FormState = { error: SerializedError | null; done: boolean };

export function SignUpForm() {
  const signUp = useServerFn(signUpFn);
  const [fields, setFields] = useState<Fields>(initialFields);
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const emailId = useId();
  const passwordId = useId();
  const displayNameId = useId();
  const emailErrorId = `${emailId}-error`;
  const passwordErrorId = `${passwordId}-error`;
  const passwordHintId = `${passwordId}-hint`;
  const displayNameErrorId = `${displayNameId}-error`;
  const doneHeadingRef = useRef<HTMLHeadingElement | null>(null);

  const errors = {
    email: emailFormatError(fields.email),
    password: passwordError(fields.password),
    displayName: displayNameError(fields.displayName),
  };
  const hasFieldError =
    errors.email !== null ||
    errors.password !== null ||
    errors.displayName !== null ||
    !fields.termsAccepted;
  const strength = passwordStrength(fields.password);

  const [state, formAction, isPending] = useActionState<FormState, FormData>(
    async (prev) => {
      try {
        await signUp({
          data: {
            email: fields.email,
            password: fields.password,
            displayName: fields.displayName,
            termsAccepted: fields.termsAccepted,
          },
        });
        return { error: null, done: true };
      } catch (error) {
        return { error: extractSerializedError(error), done: prev.done };
      }
    },
    { error: null, done: false },
  );

  // The completion panel replaces the whole form, so the submit button that
  // had focus unmounts and focus falls to `<body>`. Screen-reader users would
  // hear nothing at all; moving focus to the new heading announces it and
  // keeps the next Tab in the right place (a live region can't do that here,
  // because the announcing container unmounts along with the form).
  useEffect(() => {
    if (state.done) doneHeadingRef.current?.focus();
  }, [state.done]);

  if (state.done) {
    return (
      <div>
        <h1
          ref={doneHeadingRef}
          tabIndex={-1}
          className="text-center text-2xl font-normal tracking-tightest leading-snug"
        >
          確認メールを送信しました
        </h1>
        <p className="mt-3 mb-8 text-center text-sm text-ink-secondary">
          {fields.email}{" "}
          宛に確認メールを送りました。メール内のリンクを開くと登録が完了します。リンクは
          24 時間で無効になります。
        </p>
        <p className="text-center text-sm text-ink-secondary">
          <Link to="/signin" className={footLinkClass}>
            サインインへ
          </Link>
        </p>
      </div>
    );
  }

  const showError = (name: keyof typeof errors): string | null =>
    touched[name] === true ? errors[name] : null;

  return (
    <div>
      <h1 className="text-center text-2xl font-normal tracking-tightest leading-snug">
        アカウントを作る
      </h1>
      <p className="mt-3 mb-8 text-center text-sm text-ink-secondary">
        ファイルを HTML に変換して保存し、公開範囲を選んで共有できます。
      </p>

      {state.error !== null ? (
        <Alert tone="error" title="登録できませんでした">
          {displayError(state.error)}
        </Alert>
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
            value={fields.email}
            disabled={isPending}
            onChange={(e) => setFields({ ...fields, email: e.target.value })}
            onBlur={() => setTouched((t) => ({ ...t, email: true }))}
            aria-invalid={showError("email") !== null}
            aria-describedby={emailErrorId}
            className={`${inputClass} ${showError("email") !== null ? inputInvalidClass : ""}`}
          />
          {/* The live region stays mounted — and stays in the accessibility
              tree, so no `display: none` while empty — and only its content
              is swapped: a region that appears together with its text is not
              announced by most screen readers. */}
          <p id={emailErrorId} className={fieldErrorClass} aria-live="polite">
            {showError("email")}
          </p>
        </div>

        <div className="mb-4">
          <label className={fieldLabelClass} htmlFor={passwordId}>
            パスワード
          </label>
          <input
            id={passwordId}
            type="password"
            autoComplete="new-password"
            required
            value={fields.password}
            disabled={isPending}
            onChange={(e) => setFields({ ...fields, password: e.target.value })}
            onBlur={() => setTouched((t) => ({ ...t, password: true }))}
            aria-invalid={showError("password") !== null}
            aria-describedby={`${passwordErrorId} ${passwordHintId}`}
            className={`${inputClass} ${showError("password") !== null ? inputInvalidClass : ""}`}
          />
          <div className="mt-2 flex gap-[3px]" aria-hidden="true">
            {[1, 2, 3, 4].map((step) => (
              <i
                key={step}
                className="h-[3px] flex-1 rounded-[2px]"
                style={{
                  background:
                    step <= strength.score
                      ? strength.score >= 3
                        ? "var(--color-success)"
                        : "var(--color-warning)"
                      : "var(--color-hairline)",
                }}
              />
            ))}
          </div>
          {strength.label !== "" ? (
            <p className="mt-1 text-xs text-ink-secondary">
              強度: {strength.label}
            </p>
          ) : null}
          <p
            id={passwordErrorId}
            className={fieldErrorClass}
            aria-live="polite"
          >
            {showError("password")}
          </p>
          {showError("password") === null ? (
            <p id={passwordHintId} className="mt-2 text-xs text-ink-secondary">
              {PASSWORD_MIN_LENGTH} 文字以上で、英字と数字の両方を含めます
            </p>
          ) : null}
        </div>

        <div className="mb-4">
          <label className={fieldLabelClass} htmlFor={displayNameId}>
            表示名
          </label>
          <input
            id={displayNameId}
            type="text"
            autoComplete="nickname"
            required
            value={fields.displayName}
            disabled={isPending}
            onChange={(e) =>
              setFields({ ...fields, displayName: e.target.value })
            }
            onBlur={() => setTouched((t) => ({ ...t, displayName: true }))}
            aria-invalid={showError("displayName") !== null}
            aria-describedby={displayNameErrorId}
            className={`${inputClass} ${showError("displayName") !== null ? inputInvalidClass : ""}`}
          />
          <p
            id={displayNameErrorId}
            className={fieldErrorClass}
            aria-live="polite"
          >
            {showError("displayName")}
          </p>
        </div>

        <label className="my-5 flex cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            checked={fields.termsAccepted}
            disabled={isPending}
            onChange={(e) =>
              setFields({ ...fields, termsAccepted: e.target.checked })
            }
            className="mt-0.5 size-4 shrink-0 cursor-pointer accent-accent"
          />
          <span className="text-sm text-ink-secondary">
            <Link
              to="/terms"
              className="text-accent underline underline-offset-3"
            >
              利用規約
            </Link>
            と
            <Link
              to="/privacy"
              className="text-accent underline underline-offset-3"
            >
              プライバシーポリシー
            </Link>
            に同意します
          </span>
        </label>

        <button
          type="submit"
          disabled={isPending || hasFieldError}
          className={submitButtonClass}
        >
          {isPending ? "送信中..." : "アカウントを作る"}
        </button>
      </form>

      <OAuthButton provider="google" redirectTo={null} />

      <p className="mt-8 text-center text-sm text-ink-secondary">
        アカウントをお持ちですか？{" "}
        <Link to="/signin" className={footLinkClass}>
          サインイン
        </Link>
      </p>
    </div>
  );
}
