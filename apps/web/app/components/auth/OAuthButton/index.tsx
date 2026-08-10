"use client";

import { useActionState } from "react";
import { Alert } from "@/components/ui/Alert";
import { displayError } from "@/presentation/errorDisplay";
import { startOAuthSignInFn } from "@/routes/auth/-action";

const PROVIDER_LABEL: Readonly<Record<string, string>> = {
  google: "Google",
};

/**
 * P-01 / P-02 の「Google で続ける」（PAGE-p01-003 / p02-003）。
 *
 * 押した瞬間に外部の同意画面へ出ていくので、楽観 UI に相当するのは
 * 「行き先が決まるまでの待機表示」になる。認可 URL はサーバーが決める
 * （`state` / PKCE の保存とセットでなければ意味がない）ので、往復が 1 回
 * だけ挟まる。遷移は履歴 API ではなくフル遷移 — 行き先が外部オリジン
 * だからで、戻ってくるときも同じ形で戻る。
 */
export function OAuthButton({
  provider,
  redirectTo,
}: {
  provider: "google";
  redirectTo: string | null;
}) {
  const [error, formAction, isPending] = useActionState<
    string | null,
    FormData
  >(async () => {
    try {
      const { authorizationUrl } = await startOAuthSignInFn({
        data: { provider, redirectTo },
      });
      window.location.assign(authorizationUrl);
    } catch (cause) {
      return displayError(cause);
    }
    return null;
  }, null);
  const label = PROVIDER_LABEL[provider] ?? provider;

  return (
    <div>
      <div className="my-6 flex items-center gap-3 text-xs text-ink-tertiary before:h-px before:flex-1 before:bg-hairline after:h-px after:flex-1 after:bg-hairline">
        または
      </div>

      <form action={formAction}>
        <button
          type="submit"
          disabled={isPending}
          className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-pill border border-hairline-strong bg-bg text-sm font-medium text-ink transition-colors hover:bg-surface disabled:cursor-not-allowed disabled:opacity-55"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="9" />
            <path d="M12 8v8M8 12h8" />
          </svg>
          {isPending ? `${label} に移動しています...` : `${label} で続ける`}
        </button>
      </form>

      <div role="status" aria-live="polite">
        {error !== null ? (
          <div className="mt-4">
            <Alert
              tone="error"
              title="外部サービスに移動できませんでした"
              role="note"
            >
              {error}
            </Alert>
          </div>
        ) : null}
      </div>
    </div>
  );
}
