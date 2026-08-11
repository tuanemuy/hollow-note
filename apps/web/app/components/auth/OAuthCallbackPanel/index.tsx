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
import {
  OAUTH_FLOW_INTERRUPTED_MESSAGE,
  renderErrorMessage,
} from "@/presentation/errorDisplay";
import {
  extractSerializedError,
  type SerializedError,
} from "@/presentation/errorResponse";
import {
  completeOAuthCallbackFn,
  startOAuthSignInFn,
} from "@/routes/auth/-action";

/**
 * P-05 OAuth コールバック（spec/pages/index.md#P-05、モック
 * P05-oauth-callback.html）。GET はこの画面を描くだけで、マウント後に
 * `state` / `code` を POST で消費する（#1 ADR-029 の GET/POST 分離）。
 *
 * 状態: 処理中 / 成功（`redirectTo` へ）/ キャンセル / 失敗（state 不一致・
 * 期限切れ・通信失敗）/ 再許可（プロバイダーから受け取った情報では
 * サインインを完了できず、同意からやり直す必要がある）。
 *
 * どのユースケースを走らせるかは `state` の intent だけが決める
 * （ADR-007）ので、この画面は分岐を持たず結果だけを表示する。成功以外は
 * intent が判っていない（`state` を消費できていない）ため、文言と戻り先
 * を intent 中立に倒す（ADR-084）。
 */

type Phase =
  | { kind: "processing" }
  | { kind: "succeeded"; intent: "signIn" | "linkIdentity" }
  | { kind: "cancelled" }
  | { kind: "needsReauthorization" }
  | { kind: "failed"; message: string };

/** 戻り先が `state` に無いときの落ち着き先。intent ごとに違う。 */
const FALLBACK_PATH = {
  signIn: "/notes",
  linkIdentity: "/settings/auth",
} as const;

export function OAuthCallbackPanel({
  provider,
  state,
  code,
  error,
}: {
  provider: string;
  state: string | null;
  code: string | null;
  error: string | null;
}) {
  const router = useRouter();
  const complete = useServerFn(completeOAuthCallbackFn);
  const startAgain = useServerFn(startOAuthSignInFn);
  const [phase, setPhase] = useState<Phase>(() =>
    initialPhase(state, code, error),
  );
  const [attempt, setAttempt] = useState(0);
  // One POST per `attempt`: `state` is single-use, so StrictMode's
  // double-invoked effect must not consume it twice.
  const started = useRef(-1);

  useEffect(() => {
    if (state === null || code === null || error !== null) return;
    if (started.current === attempt) return;
    started.current = attempt;
    void (async () => {
      let result: Awaited<ReturnType<typeof complete>>;
      try {
        result = await complete({ data: { provider, state, code } });
      } catch (thrown) {
        setPhase(classify(extractSerializedError(thrown)));
        return;
      }
      setPhase({ kind: "succeeded", intent: result.intent });
      // The outcome is already durable; neither step below can turn this
      // back into a failure, so both sit outside the try.
      await router.invalidate().catch(() => {
        console.error("Post-callback reconcile failed");
      });
      router.history.push(result.redirectTo ?? FALLBACK_PATH[result.intent]);
    })();
  }, [provider, state, code, error, complete, router, attempt]);

  const retryAuthorization = useCallback(() => {
    setPhase({ kind: "processing" });
    void (async () => {
      try {
        const { authorizationUrl } = await startAgain({
          data: { provider, redirectTo: null },
        });
        window.location.assign(authorizationUrl);
      } catch (thrown) {
        setPhase(classify(extractSerializedError(thrown)));
      }
    })();
  }, [provider, startAgain]);

  const retryExchange = useCallback(() => {
    setPhase({ kind: "processing" });
    setAttempt((value) => value + 1);
  }, []);

  // The whole flow runs without a user action, so this live region is the
  // only cue assistive technology gets. It must be mounted before the
  // outcome arrives and stay mounted across phases.
  return (
    <div role="status" aria-live="polite">
      <PhaseResult
        phase={phase}
        onRetryAuthorization={retryAuthorization}
        onRetryExchange={retryExchange}
      />
    </div>
  );
}

function initialPhase(
  state: string | null,
  code: string | null,
  error: string | null,
): Phase {
  if (error === "access_denied") {
    return { kind: "cancelled" };
  }
  if (error !== null || state === null || code === null) {
    return { kind: "failed", message: OAUTH_FLOW_INTERRUPTED_MESSAGE };
  }
  return { kind: "processing" };
}

// 文言はすべて辞書（`errorDisplay`）に任せ、ここで分岐するのは画面状態が
// 変わる 1 件だけにする。
function classify(error: SerializedError): Phase {
  if (error.kind === "validation" && error.code === "OAUTH_EMAIL_UNVERIFIED") {
    return { kind: "needsReauthorization" };
  }
  return { kind: "failed", message: renderErrorMessage(error) };
}

function PhaseResult({
  phase,
  onRetryAuthorization,
  onRetryExchange,
}: {
  phase: Phase;
  onRetryAuthorization: () => void;
  onRetryExchange: () => void;
}) {
  switch (phase.kind) {
    case "processing":
      return (
        <Result
          icon={<Spinner />}
          title="手続きを完了しています"
          body="終わったら元の画面に戻ります。"
        />
      );
    case "succeeded":
      return phase.intent === "linkIdentity" ? (
        <Result
          icon={<CheckIcon className="text-success" />}
          title="ログイン方法を追加しました"
          body="次回からこの方法でもサインインできます。"
          actions={
            <Link to="/settings/auth" className={primaryClass}>
              設定へ戻る
            </Link>
          }
        />
      ) : (
        <Result
          icon={<CheckIcon className="text-success" />}
          title="サインインしました"
          body="そのまま使い始められます。"
          actions={
            <Link to="/notes" className={primaryClass}>
              Hollow を開く
            </Link>
          }
        />
      );
    case "cancelled":
      return (
        <Result
          icon={<MinusIcon className="text-ink-tertiary" />}
          title="手続きをキャンセルしました"
          body="何も変更されていません。必要になったらいつでもやり直せます。"
          actions={
            <Link to="/" className={outlineClass}>
              Hollow に戻る
            </Link>
          }
        />
      );
    // この状態に来るのはサインインの経路だけ（`OAUTH_EMAIL_UNVERIFIED` は
    // `completeOAuthSignIn` しか投げない）ので、ここだけは intent を前提に
    // した文言と再開導線でよい。
    case "needsReauthorization":
      return (
        <Result
          icon={<AlertIcon className="text-warning" />}
          title="必要な情報が足りません"
          body="サインインには、確認済みのメールアドレスの共有を許可する必要があります。"
          actions={
            <>
              <button
                type="button"
                onClick={onRetryAuthorization}
                className={primaryClass}
              >
                もう一度許可する
              </button>
              <Link to="/signin" className={ghostClass}>
                やめる
              </Link>
            </>
          }
        />
      );
    case "failed":
      return (
        <Result
          icon={<CrossIcon className="text-error" />}
          title="手続きを完了できませんでした"
          body={phase.message}
          actions={
            <>
              <button
                type="button"
                onClick={onRetryExchange}
                className={primaryClass}
              >
                もう一度試す
              </button>
              <Link to="/" className={ghostClass}>
                Hollow に戻る
              </Link>
            </>
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

const primaryClass =
  "inline-flex h-10 items-center justify-center rounded-pill bg-accent px-5 text-sm font-medium text-bg transition-colors hover:bg-accent-hover active:bg-accent-pressed";

const outlineClass =
  "inline-flex h-10 items-center justify-center rounded-pill border border-hairline-strong bg-bg px-5 text-sm font-medium text-ink transition-colors hover:bg-surface";

const ghostClass =
  "inline-flex h-10 items-center justify-center rounded-pill px-5 text-sm font-medium text-ink-secondary transition-colors hover:bg-surface hover:text-ink";

function Spinner() {
  return (
    <span
      aria-hidden="true"
      className="size-7 animate-spin rounded-full border-2 border-accent border-t-transparent motion-reduce:animate-none"
    />
  );
}

function CheckIcon({ className }: { className: string }) {
  return (
    <ResultIcon className={className}>
      <circle cx="12" cy="12" r="10" />
      <polyline points="16 9.5 10.8 15 8 12.3" />
    </ResultIcon>
  );
}

function MinusIcon({ className }: { className: string }) {
  return (
    <ResultIcon className={className}>
      <circle cx="12" cy="12" r="10" />
      <line x1="8" y1="12" x2="16" y2="12" />
    </ResultIcon>
  );
}

function AlertIcon({ className }: { className: string }) {
  return (
    <ResultIcon className={className}>
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12" y2="17" />
    </ResultIcon>
  );
}

function CrossIcon({ className }: { className: string }) {
  return (
    <ResultIcon className={className}>
      <circle cx="12" cy="12" r="10" />
      <line x1="15" y1="9" x2="9" y2="15" />
      <line x1="9" y1="9" x2="15" y2="15" />
    </ResultIcon>
  );
}

function ResultIcon({
  className,
  children,
}: {
  className: string;
  children: ReactNode;
}) {
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
      {children}
    </svg>
  );
}
