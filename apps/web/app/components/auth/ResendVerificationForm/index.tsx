"use client";

import { useServerFn } from "@tanstack/react-start";
import { useActionState, useEffect, useId, useState } from "react";
import { displayError } from "@/presentation/errorDisplay";
import { emailFormatError } from "../fieldValidation";
import {
  fieldErrorClass,
  fieldLabelClass,
  inputClass,
  inputInvalidClass,
} from "../formStyles";
import { resendVerificationFn } from "./action";

/**
 * 確認メールの再送導線（PAGE-p03-003 / PAGE-p02-006）。P-03 の期限切れ・
 * 無効状態と P-02 の未確認状態が同じ操作を出すので、1 つの island を
 * 共有する。
 *
 * `email` が既知（P-02 はフォームの入力値）ならボタンだけを、未知
 * （P-03 はリンクからの来訪でアドレスを知らない）ならメール入力欄と
 * 一緒に出す。
 *
 * 状態は「送信中 / 送信済み / クールダウン中」の三態で、完了表示は
 * 宛先の状態によらず同一にする（spec/adr/028-account-enumeration-
 * resistance.md）。クールダウンは usecase の 60 秒の発行間隔を写した
 * 案内で、サーバー側の判定が正 — 早すぎる再送は無送信の成功になるだけ
 * なので、待ち時間の表示以上のことはしない。
 *
 * 自前の live region は持たない。呼び出し元（P-03 の結果パネル・P-02 の
 * アラート枠）が常設の `role="status"` の中にこれを置くので、入れ子に
 * すると同じ文言が二重に読み上げられる。
 */

const COOLDOWN_MS = 60 * 1000;

type Phase =
  | { kind: "idle" }
  | { kind: "sent"; until: number }
  | { kind: "failed"; message: string };

type Variant = "primary" | "outline" | "compact";

const BUTTON_BASE =
  "inline-flex items-center justify-center gap-2 rounded-pill font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-55";

const BUTTON_BY_VARIANT: Record<Variant, string> = {
  primary: `${BUTTON_BASE} h-10 px-5 text-sm bg-accent text-bg hover:bg-accent-hover active:bg-accent-pressed disabled:hover:bg-accent`,
  outline: `${BUTTON_BASE} h-10 px-5 text-sm border border-hairline-strong bg-bg text-ink hover:bg-surface disabled:hover:bg-bg`,
  compact: `${BUTTON_BASE} h-8 px-3 text-xs border border-hairline-strong bg-bg text-ink hover:bg-surface disabled:hover:bg-bg`,
};

function remainingSeconds(deadline: number, now: number): number {
  return Math.max(0, Math.ceil((deadline - now) / 1000));
}

export function ResendVerificationForm({
  email,
  variant = "outline",
}: {
  email: string | null;
  variant?: Variant;
}) {
  const resend = useServerFn(resendVerificationFn);
  const emailId = useId();
  const emailErrorId = `${emailId}-error`;
  const [typed, setTyped] = useState("");
  const [touched, setTouched] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const address = email ?? typed;
  const formatError = emailFormatError(address);
  const shownFormatError = email === null && touched ? formatError : null;

  const [state, formAction, isPending] = useActionState<
    { phase: Phase },
    FormData
  >(
    async () => {
      try {
        await resend({ data: { email: address.trim() } });
      } catch (error) {
        return { phase: { kind: "failed", message: displayError(error) } };
      }
      return { phase: { kind: "sent", until: Date.now() + COOLDOWN_MS } };
    },
    { phase: { kind: "idle" } },
  );

  const phase = state.phase;
  const deadline = phase.kind === "sent" ? phase.until : null;
  const cooling = deadline !== null && deadline > now;

  // Depends on the deadline only: re-subscribing every tick would rebuild
  // the interval each second. The timer stops itself once it passes.
  useEffect(() => {
    if (deadline === null || deadline <= Date.now()) return;
    const timer = setInterval(() => {
      const current = Date.now();
      setNow(current);
      if (deadline <= current) clearInterval(timer);
    }, 1000);
    return () => clearInterval(timer);
  }, [deadline]);

  const disabled = isPending || cooling || formatError !== null;

  return (
    <form action={formAction} className="w-full" noValidate>
      {email === null ? (
        <div className="mb-3 text-left">
          <label className={fieldLabelClass} htmlFor={emailId}>
            メールアドレス
          </label>
          <input
            id={emailId}
            type="email"
            autoComplete="email"
            required
            value={typed}
            disabled={isPending}
            onChange={(e) => setTyped(e.target.value)}
            onBlur={() => setTouched(true)}
            aria-invalid={shownFormatError !== null}
            aria-describedby={emailErrorId}
            className={`${inputClass} ${shownFormatError !== null ? inputInvalidClass : ""}`}
          />
          {/* 常設のまま。`aria-live` は付けない — 呼び出し元の live region
              の中なので、入れ子にすると同じ文言が二重に読まれる。 */}
          <p id={emailErrorId} className={fieldErrorClass}>
            {shownFormatError}
          </p>
        </div>
      ) : null}

      <button
        type="submit"
        disabled={disabled}
        className={BUTTON_BY_VARIANT[variant]}
      >
        {isPending ? "送信中..." : "確認メールを再送"}
      </button>

      <PhaseNote phase={phase} cooling={cooling} now={now} />
    </form>
  );
}

function PhaseNote({
  phase,
  cooling,
  now,
}: {
  phase: Phase;
  cooling: boolean;
  now: number;
}) {
  switch (phase.kind) {
    case "idle":
      return null;
    case "sent":
      return (
        <p className="mt-2 text-xs text-ink-secondary">
          確認メールを送りました。届かない場合は迷惑メールフォルダーもご確認ください。
          {/* 呼び出し元の live region が毎秒読み上げ直さないよう、進む
              カウンターだけ支援技術から隠す。 */}
          {cooling ? (
            <span aria-hidden="true">
              （あと {remainingSeconds(phase.until, now)} 秒）
            </span>
          ) : null}
        </p>
      );
    case "failed":
      return <p className="mt-2 text-xs text-error">{phase.message}</p>;
  }
}
