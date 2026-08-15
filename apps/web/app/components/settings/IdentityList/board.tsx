"use client";

import type { IdentityListItemView } from "@repo/core/application/identity/view";
import { IdentityPolicy } from "@repo/core/domain/identity/services/identityPolicy";
import { useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  useEffect,
  useOptimistic,
  useRef,
  useState,
  useTransition,
} from "react";
import { AddPasswordForm } from "@/components/settings/AddPasswordForm";
import { ChangePasswordForm } from "@/components/settings/ChangePasswordForm";
import {
  dangerButtonClass,
  errorTextClass,
  ghostButtonClass,
  panelClass,
  panelNoteClass,
  panelTitleClass,
  subtleButtonClass,
} from "@/components/settings/panelStyles";
import { displayError } from "@/presentation/errorDisplay";
import {
  addPasswordFn,
  removeIdentityFn,
  signOutOtherSessionsFn,
  startOAuthLinkFn,
} from "@/routes/settings/-action";

/**
 * P-22 の操作を持つ島（モック P22-settings-auth.html）。
 *
 * 追加と解除はリストの増減なので、CLAUDE.md の所有権の規則どおり**この
 * 親が所有する**。特に解除は、楽観的除去が行を先にアンマウントするため
 * 行側に持たせるとエラー表示ごと消えてしまう。パスワード変更と他端末
 * サインアウトはリストを変えないので、それぞれの葉が自分で持つ。
 *
 * 楽観的リストはサーバー truth（`identities` prop）を土台に再計算される
 * ので、各操作の最後の `router.invalidate()` で必ず実データへ戻る。
 */

type OptimisticAction =
  | Readonly<{ kind: "remove"; identityId: string }>
  | Readonly<{ kind: "addPassword" }>;

const OPTIMISTIC_PASSWORD_ID = "optimistic-password";

function applyOptimistic(
  current: readonly IdentityListItemView[],
  action: OptimisticAction,
): readonly IdentityListItemView[] {
  switch (action.kind) {
    case "remove":
      return current.filter((item) => item.id !== action.identityId);
    case "addPassword":
      return [
        ...current,
        {
          id: OPTIMISTIC_PASSWORD_ID,
          kind: "password",
          provider: null,
          accountLabel: null,
          createdAt: new Date(),
        },
      ];
  }
}

export function IdentityBoard({
  identities,
  removable,
}: {
  identities: readonly IdentityListItemView[];
  removable: boolean;
}) {
  const router = useRouter();
  const removeIdentity = useServerFn(removeIdentityFn);
  const addPassword = useServerFn(addPasswordFn);
  const startOAuthLink = useServerFn(startOAuthLinkFn);

  const [optimistic, dispatchOptimistic] = useOptimistic(
    identities,
    applyOptimistic,
  );
  const [isRemoving, startRemoving] = useTransition();
  const [isLinking, startLinking] = useTransition();
  const [listError, setListError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const headingRef = useRef<HTMLHeadingElement | null>(null);

  // 解除の可否は楽観的リストから引き直す。サーバーが返した `removable`
  // は解除前の集合に対する判定なので、1 件消した直後に「まだ解除できる」
  // と見えてしまう。しきい値はドメインの `IdentityPolicy` から取る
  // （`isRemovable` そのものは `Identity` を要求するので、DTO しか持たない
  // ここからは呼べない）。
  const canRemove =
    optimistic.length > IdentityPolicy.minIdentitiesPerUser && removable;
  const hasPassword = optimistic.some((item) => item.kind === "password");
  const hasGoogle = optimistic.some((item) => item.provider === "google");

  const reconcile = () =>
    router.invalidate().catch(() => {
      console.error("Identity list reconcile failed");
    });

  const onRemove = (identityId: string) => {
    setConfirming(null);
    startRemoving(async () => {
      setNotice(null);
      dispatchOptimistic({ kind: "remove", identityId });
      try {
        await removeIdentity({ data: { identityId } });
      } catch (error) {
        setListError(displayError(error));
        return;
      }
      setListError(null);
      setNotice("ログイン方法を解除しました。");
      // 押した「解除する」は楽観的除去で行ごと消えるので、焦点をこの
      // リストの見出しへ引き取らないと `document.body` へ落ちる。
      headingRef.current?.focus();
      await reconcile();
    });
  };

  const onAddPassword = async (newPassword: string): Promise<void> => {
    setNotice(null);
    dispatchOptimistic({ kind: "addPassword" });
    await addPassword({ data: { newPassword } });
    setAdding(false);
    setNotice(
      "パスワードを追加しました。次回からメールアドレスとパスワードでもサインインできます。",
    );
    await reconcile();
  };

  const onLinkGoogle = () => {
    startLinking(async () => {
      let authorizationUrl: string;
      try {
        ({ authorizationUrl } = await startOAuthLink({
          data: { provider: "google" },
        }));
      } catch (error) {
        setListError(displayError(error));
        return;
      }
      setListError(null);
      // 認可画面は別オリジンなので、router ではなくフル遷移で出る。
      window.location.assign(authorizationUrl);
    });
  };

  return (
    <>
      <section className={panelClass}>
        <h2
          ref={headingRef}
          tabIndex={-1}
          className={`${panelTitleClass} focus-visible:shadow-none`}
        >
          有効なログイン方法
        </h2>
        <p className={panelNoteClass}>少なくとも 1 つは残す必要があります。</p>

        <ul>
          {optimistic.map((item) => (
            <MethodRow
              key={item.id}
              item={item}
              canRemove={canRemove}
              busy={isRemoving}
              confirming={confirming === item.id}
              onConfirm={() => setConfirming(item.id)}
              onCancel={() => setConfirming(null)}
              onRemove={() => onRemove(item.id)}
            />
          ))}
        </ul>

        {canRemove ? null : (
          <p
            id={LAST_METHOD_HINT_ID}
            className="mt-3 text-xs text-ink-tertiary"
          >
            最後のログイン方法は解除できません。別の方法を追加してから解除してください。
          </p>
        )}

        {hasPassword && hasGoogle ? null : (
          <div className="mt-5 flex flex-wrap gap-2 border-t border-hairline pt-5">
            {hasPassword ? null : (
              <button
                type="button"
                className={subtleButtonClass}
                onClick={() => setAdding(true)}
              >
                パスワードを追加
              </button>
            )}
            {hasGoogle ? null : (
              <button
                type="button"
                className={subtleButtonClass}
                disabled={isLinking}
                aria-busy={isLinking}
                onClick={onLinkGoogle}
              >
                {isLinking ? "認可画面へ移動中..." : "Google を追加"}
              </button>
            )}
          </div>
        )}

        {/* 常設の live region。追加 / 解除の失敗と成功はここだけに出る。 */}
        <p className={errorTextClass} role="status" aria-live="polite">
          {listError}
        </p>
        <p className="text-xs text-success not-empty:mt-2" aria-live="polite">
          {notice}
        </p>
      </section>

      <AddPasswordForm
        open={adding}
        onClose={() => setAdding(false)}
        onSubmit={onAddPassword}
      />

      {hasPassword ? <ChangePasswordForm /> : null}

      <SignOutOthersPanel onDone={reconcile} />
    </>
  );
}

function MethodRow({
  item,
  canRemove,
  busy,
  confirming,
  onConfirm,
  onCancel,
  onRemove,
}: {
  item: IdentityListItemView;
  canRemove: boolean;
  busy: boolean;
  confirming: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  onRemove: () => void;
}) {
  const confirmRef = useRef<HTMLButtonElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  // 焦点を動かすのはこの行を操作したときだけ。他の行の確認を開いた結果と
  // して閉じた場合まで動かすと、開いた側から焦点を奪い返してしまう。
  const moveFocus = useRef(false);

  // 確認 UI はボタンごと差し替わるので、焦点を移さないと `document.body`
  // へ落ち、破壊的操作の確認が出たことがどこにも伝わらない。
  useEffect(() => {
    if (!moveFocus.current) {
      return;
    }
    moveFocus.current = false;
    (confirming ? confirmRef : triggerRef).current?.focus();
  }, [confirming]);

  const password = item.kind === "password";
  const name = password
    ? "メールアドレスとパスワード"
    : (PROVIDER_LABELS[item.provider ?? ""] ?? item.provider);
  const sub = password
    ? `追加 ${formatDate(item.createdAt)}`
    : `${item.accountLabel ?? "アカウント不明"} で連携済み`;

  return (
    <li className="grid grid-cols-[auto_1fr_auto] items-center gap-3 border-t border-hairline py-4 first:border-t-0 first:pt-0">
      <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-md bg-surface text-ink-secondary">
        {password ? <LockIcon /> : <LinkIcon />}
      </span>
      <span className="min-w-0">
        <span className="flex flex-wrap items-center gap-2 text-sm font-medium">
          {name}
          <span className="inline-flex h-5 items-center rounded-pill border border-success/30 px-2 text-xs font-medium text-success">
            有効
          </span>
        </span>
        <span className="mt-0.5 block text-xs text-ink-tertiary">{sub}</span>
      </span>
      <span className="flex shrink-0 gap-2">
        {confirming ? (
          <>
            <button
              ref={confirmRef}
              type="button"
              className={dangerButtonClass}
              disabled={busy}
              onClick={onRemove}
            >
              解除する
            </button>
            <button
              type="button"
              className={ghostButtonClass}
              onClick={() => {
                moveFocus.current = true;
                onCancel();
              }}
            >
              やめる
            </button>
          </>
        ) : (
          <button
            ref={triggerRef}
            type="button"
            className={dangerButtonClass}
            disabled={!canRemove || busy}
            aria-describedby={canRemove ? undefined : LAST_METHOD_HINT_ID}
            onClick={() => {
              moveFocus.current = true;
              onConfirm();
            }}
          >
            解除
          </button>
        )}
      </span>
    </li>
  );
}

function SignOutOthersPanel({ onDone }: { onDone: () => Promise<void> }) {
  const signOutOthers = useServerFn(signOutOtherSessionsFn);
  const [isPending, startTransition] = useTransition();
  const [outcome, setOutcome] = useState<"idle" | "accepted">("idle");
  const [error, setError] = useState<string | null>(null);

  const onClick = () => {
    startTransition(async () => {
      try {
        await signOutOthers({});
      } catch (thrown) {
        setError(displayError(thrown));
        return;
      }
      setError(null);
      setOutcome("accepted");
      await onDone();
    });
  };

  return (
    <section className={panelClass}>
      <h2 className={panelTitleClass}>他の端末からサインアウト</h2>
      <p className={panelNoteClass}>
        この端末以外のすべてのセッションを終了します。パスワードが漏れたおそれがあるときに使ってください。
      </p>
      <button
        type="button"
        className={dangerButtonClass}
        disabled={isPending}
        aria-busy={isPending}
        onClick={onClick}
      >
        {isPending ? "処理中..." : "他のすべての端末からサインアウト"}
      </button>
      <p className={errorTextClass} role="status" aria-live="polite">
        {error}
      </p>
      <p className="text-xs text-success not-empty:mt-2" aria-live="polite">
        {outcome === "accepted"
          ? "他の端末のサインインを解除しました。この端末はそのまま使えます。"
          : null}
      </p>
    </section>
  );
}

const LAST_METHOD_HINT_ID = "identity-last-method-hint";

const PROVIDER_LABELS: Readonly<Record<string, string>> = {
  google: "Google",
};

// 時間帯を明示する。この島は SSR で 1 度描かれてからハイドレートされる
// ので、既定（実行環境の時間帯）のままだとサーバーとブラウザーで日付が
// 1 日ずれ、その差がハイドレーション不一致として出る。
const dateFormat = new Intl.DateTimeFormat("ja-JP", {
  year: "numeric",
  month: "long",
  day: "numeric",
  timeZone: "UTC",
});

const formatDate = (value: Date): string => dateFormat.format(value);

function LockIcon() {
  return (
    <svg
      width="17"
      height="17"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="11" width="18" height="11" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

function LinkIcon() {
  return (
    <svg
      width="17"
      height="17"
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
  );
}
