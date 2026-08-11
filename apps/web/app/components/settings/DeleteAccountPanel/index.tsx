"use client";

import { useServerFn } from "@tanstack/react-start";
import { useActionState, useEffect, useId, useRef, useState } from "react";
import {
  fieldErrorClass,
  fieldLabelClass,
  inputClass,
  inputInvalidClass,
} from "@/components/auth/formStyles";
import {
  dangerActionButtonClass,
  dangerPanelClass,
  dangerPanelTitleClass,
  ghostButtonClass,
  panelNoteClass,
} from "@/components/settings/panelStyles";
import { Alert } from "@/components/ui/Alert";
import { renderErrorMessage } from "@/presentation/errorDisplay";
import { extractSerializedError } from "@/presentation/errorResponse";
import {
  deleteAccountFn,
  getDeletionStatusFn,
} from "@/routes/settings/-action";

/**
 * P-25 アカウント削除（モック P25-settings-danger.html、PAGE-p25-001..003）。
 *
 * 実行は同じ応答でセッションを失効させるので、この画面には他と違う 2 つ
 * の規律がある（ADR-006）。**遷移しない** — ticket を持つこの島がその場
 * で消えると、正常系の 1 手目で進捗照会の手段が無くなる。そして三層規律
 * の唯一の例外として **`router.invalidate()` を呼ばない** — 再基底化する
 * とローダーが `UNAUTHENTICATED` で落ちて進捗表示ごと消える。再基底化の
 * 役割は、完了表示に到達したあとのフル遷移が担う。
 *
 * 唯一 owner による実行不可（PAGE-p25-004）は別スライスなので、その導線
 * も無効ボタンの placeholder も置かない。
 */

const TICKET_STORAGE_KEY = "hollow.account-deletion-ticket";
const POLL_INTERVAL_MS = 1500;
const COMPLETION_LEAVE_MS = 5000;

type Phase =
  | Readonly<{ kind: "idle" }>
  /** 受理済み・最初の進捗がまだ返っていない。 */
  | Readonly<{ kind: "accepted"; ticket: string }>
  | Readonly<{ kind: "running"; ticket: string }>
  | Readonly<{ kind: "completed" }>
  | Readonly<{ kind: "settled"; message: string }>;

/**
 * 提出の失敗はどこに出すかまで持つ。項目エラー欄はメールアドレス不一致
 * の専用枠で、認証切れのような入力と無関係な失敗をそこへ出すと、無関係
 * な欄に `aria-invalid` が付く（ADR-085）。
 */
type SubmitError = Readonly<{ target: "field" | "panel"; message: string }>;

type SubmitState = Readonly<{ error: SubmitError | null }>;

const IDLE_SUBMIT_STATE: SubmitState = { error: null };

const submitError = (error: unknown): SubmitError => {
  const serialized = extractSerializedError(error);
  return {
    target: serialized.code === "CONFIRMATION_MISMATCH" ? "field" : "panel",
    message: renderErrorMessage(serialized),
  };
};

/**
 * `crypto.randomUUID` はセキュアコンテキスト限定なので、LAN の IP で開いた
 * 開発サーバーでは存在しない。`requestId` は再送を同じ要求に畳むための鍵で
 * あり、サーバーが UUID 形式を要求する（`INVALID_REQUEST_ID`）ので、代替も
 * v4 の形で組む。
 */
const newRequestId = (): string => {
  if (typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

const leave = (): void => {
  // フル遷移。router キャッシュにはサインアウト済みセッションの RSC
  // ペイロードが残っているので、SPA 遷移では捨てられない（#1 ADR-028）。
  window.location.assign("/");
};

export function DeleteAccountPanel() {
  const requestDeletion = useServerFn(deleteAccountFn);
  const readStatus = useServerFn(getDeletionStatusFn);

  const confirmId = useId();
  const confirmErrorId = useId();
  // 同じ確認画面からの再送は同じ要求として扱わせる（同一 `requestId` は
  // 新しい operation を作らない）。生成はクライアントでの提出時に限る。
  const requestIdRef = useRef<string | null>(null);

  const [phase, setPhase] = useState<Phase>({ kind: "idle" });

  const [submitState, submit, isSubmitting] = useActionState(
    async (
      _previous: SubmitState,
      formData: FormData,
    ): Promise<SubmitState> => {
      try {
        requestIdRef.current ??= newRequestId();
        const { ticket } = await requestDeletion({
          data: {
            confirmationEmail: String(formData.get("confirmationEmail") ?? ""),
            requestId: requestIdRef.current,
          },
        });
        // リロードから復帰できるように退避する。ticket は Cookie では
        // なく応答 body で来るので、保持はクライアントの責任。
        sessionStorage.setItem(TICKET_STORAGE_KEY, ticket);
        setPhase({ kind: "accepted", ticket });
      } catch (error) {
        return { error: submitError(error) };
      }
      return IDLE_SUBMIT_STATE;
    },
    IDLE_SUBMIT_STATE,
  );

  useEffect(() => {
    const stored = sessionStorage.getItem(TICKET_STORAGE_KEY);
    if (stored !== null) {
      setPhase({ kind: "accepted", ticket: stored });
    }
  }, []);

  const activeTicket =
    phase.kind === "accepted" || phase.kind === "running" ? phase.ticket : null;

  useEffect(() => {
    if (activeTicket === null) {
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    /** 終端に達した ticket は用済みなので捨てる。 */
    const settle = (next: Phase): void => {
      sessionStorage.removeItem(TICKET_STORAGE_KEY);
      setPhase(next);
    };

    const poll = async (): Promise<void> => {
      try {
        const view = await readStatus({ data: { ticket: activeTicket } });
        if (cancelled) return;
        if (view.status === "completed") {
          settle({ kind: "completed" });
          return;
        }
        if (view.status === "rejected") {
          settle({
            kind: "settled",
            message:
              "削除を完了できませんでした。サインインし直して状態をご確認ください。",
          });
          return;
        }
        setPhase((current) =>
          current.kind === "accepted"
            ? { kind: "running", ticket: activeTicket }
            : current,
        );
        timer = setTimeout(() => void poll(), POLL_INTERVAL_MS);
      } catch (error) {
        if (cancelled) return;
        const serialized = extractSerializedError(error);
        const next: Phase = {
          kind: "settled",
          message: renderErrorMessage(serialized),
        };
        // 恒久的に失効した ticket は捨てる — 残すと復元して即失敗する
        // だけで、そのタブから削除フォームへ戻れなくなる。一時障害の
        // ticket は残し、再読込でのポーリング再開に賭ける。
        if (
          serialized.code === "DELETION_TICKET_EXPIRED" ||
          serialized.code === "DELETION_TICKET_INVALID"
        ) {
          settle(next);
          return;
        }
        setPhase(next);
      }
    };

    void poll();
    return () => {
      cancelled = true;
      if (timer !== undefined) {
        clearTimeout(timer);
      }
    };
  }, [activeTicket, readStatus]);

  useEffect(() => {
    if (phase.kind !== "completed") {
      return;
    }
    const timer = setTimeout(leave, COMPLETION_LEAVE_MS);
    return () => clearTimeout(timer);
  }, [phase.kind]);

  if (phase.kind !== "idle") {
    return <DeletionProgress phase={phase} />;
  }

  const failure = submitState.error;
  const fieldError = failure?.target === "field" ? failure.message : null;
  const panelError = failure?.target === "panel" ? failure.message : null;

  return (
    <section className={dangerPanelClass}>
      <h2 className={dangerPanelTitleClass}>アカウントを削除</h2>

      <div className="mb-5 grid gap-5 sm:grid-cols-2 sm:gap-6">
        <ConsequenceList
          title="削除されるもの"
          tone="gone"
          items={[
            "個人のノートと、その元ファイル",
            "公開ページとすべての共有リンク",
            "アイコンなどのアップロード済みファイル",
            "すべてのログイン方法とセッション",
          ]}
        />
        <ConsequenceList
          title="削除されないもの"
          tone="stay"
          items={[
            "ワークスペースが持つノート（作成者は「退会した利用者」と表示されます）",
            "他のメンバーが取り込んだ元ファイル",
          ]}
        />
      </div>

      <p className={panelNoteClass}>
        この操作は取り消せません。実行すると直ちにサインアウトし、削除の処理が終わるまでこの画面で進捗を表示します。
      </p>

      <form action={submit}>
        <div className="mb-4">
          <label className={fieldLabelClass} htmlFor={confirmId}>
            確認のため、アカウントのメールアドレスを入力してください
          </label>
          <input
            className={`${inputClass} ${fieldError === null ? "" : inputInvalidClass}`}
            id={confirmId}
            name="confirmationEmail"
            type="email"
            autoComplete="off"
            required
            disabled={isSubmitting}
            aria-invalid={fieldError !== null}
            aria-describedby={confirmErrorId}
          />
          <p className={fieldErrorClass} id={confirmErrorId} aria-live="polite">
            {fieldError}
          </p>
        </div>

        {/* 常設の live region。入力と無関係な失敗はこちらに出す。 */}
        <p
          className={`${fieldErrorClass} not-empty:mb-3`}
          role="status"
          aria-live="polite"
        >
          {panelError}
        </p>

        <button
          type="submit"
          className={dangerActionButtonClass}
          disabled={isSubmitting}
          aria-busy={isSubmitting}
        >
          {isSubmitting ? "受付中..." : "アカウントを削除する"}
        </button>
      </form>
    </section>
  );
}

function DeletionProgress({
  phase,
}: {
  phase: Exclude<Phase, { kind: "idle" }>;
}) {
  switch (phase.kind) {
    case "completed":
      return (
        <section className={dangerPanelClass}>
          <h2 className={dangerPanelTitleClass}>アカウントを削除しました</h2>
          <p className={panelNoteClass}>
            データの削除が完了しました。ご利用ありがとうございました。まもなくトップページへ移動します。
          </p>
          <button type="button" className={ghostButtonClass} onClick={leave}>
            トップページへ
          </button>
        </section>
      );
    case "settled":
      return (
        <section className={dangerPanelClass}>
          <h2 className={dangerPanelTitleClass}>削除の進捗を表示できません</h2>
          <p className={panelNoteClass}>{phase.message}</p>
          <button type="button" className={ghostButtonClass} onClick={leave}>
            トップページへ
          </button>
        </section>
      );
    case "accepted":
    case "running":
      return (
        <section className={dangerPanelClass} aria-busy="true">
          <h2 className={dangerPanelTitleClass}>アカウントを削除しています</h2>
          <Alert role="status" tone="info" title="サインアウトしました">
            削除の処理は続いています。このページを閉じても処理は進みます。
          </Alert>
          <p className={panelNoteClass} aria-live="polite">
            {phase.kind === "accepted"
              ? "削除の要求を受け付けました。"
              : "データを削除しています。しばらくお待ちください。"}
          </p>
        </section>
      );
  }
}

function ConsequenceList({
  title,
  tone,
  items,
}: {
  title: string;
  tone: "gone" | "stay";
  items: readonly string[];
}) {
  return (
    <div>
      <div className="mb-2 text-xs uppercase tracking-[0.06em] text-ink-tertiary">
        {title}
      </div>
      <ul>
        {items.map((item) => (
          <li
            key={item}
            className="flex items-start gap-2 py-1 text-sm text-ink-secondary"
          >
            <span
              className={`mt-[3px] shrink-0 ${tone === "gone" ? "text-error" : "text-success"}`}
            >
              {tone === "gone" ? <CrossIcon /> : <CheckIcon />}
            </span>
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

function CrossIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}
