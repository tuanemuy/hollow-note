"use client";

import type { ProfileView } from "@repo/core/application/identity/view";
import { useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  useActionState,
  useEffect,
  useId,
  useOptimistic,
  useRef,
  useState,
  useTransition,
} from "react";
import {
  fieldErrorClass,
  fieldLabelClass,
  inputClass,
  inputInvalidClass,
} from "@/components/auth/formStyles";
import {
  errorTextClass,
  ghostButtonClass,
  panelClass,
  panelNoteClass,
  panelTitleClass,
  primaryButtonClass,
  subtleButtonClass,
} from "@/components/settings/panelStyles";
import { displayError } from "@/presentation/errorDisplay";
import { extractSerializedError } from "@/presentation/errorResponse";
import {
  checkHandleAvailabilityFn,
  updateProfileFn,
  uploadAvatarFn,
} from "@/routes/settings/-action";

/**
 * P-21 の編集を持つ島（モック P21-settings-profile.html）。
 *
 * 表示名 / 自己紹介 / ハンドルは 1 つのフォームで保存し、`useActionState`
 * が保留状態と結果表示を持つ。アイコンだけは別の操作で、選択した時点で
 * `storeAvatar` → `updateProfile` の 2 段（ADR-016）を走らせる —
 * `storeAvatar` は `User` を書かないので、この 2 段目が無いと保管だけ
 * 成功してプロフィールに出ない。差し替え中は `useOptimistic` が選んだ
 * 画像を先に見せ、`router.invalidate()` でサーバー truth に戻す。
 */

const ACCEPTED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"];
const AVATAR_MAX_BYTES = 5 * 1024 * 1024;
const DISPLAY_NAME_MAX_LENGTH = 50;
const BIO_MAX_LENGTH = 500;
const HANDLE_CHECK_DEBOUNCE_MS = 400;

type SaveState = Readonly<{
  status: "idle" | "saved" | "error";
  message: string | null;
  suggestions: readonly string[];
}>;

const IDLE_SAVE_STATE: SaveState = {
  status: "idle",
  message: null,
  suggestions: [],
};

type HandleHint =
  | Readonly<{ kind: "idle" }>
  | Readonly<{ kind: "checking" }>
  | Readonly<{ kind: "available" }>
  | Readonly<{ kind: "problem"; message: string }>;

export function ProfileEditor({
  profile,
  handlePrefix,
}: {
  profile: ProfileView;
  handlePrefix: string;
}) {
  const router = useRouter();
  const updateProfile = useServerFn(updateProfileFn);
  const uploadAvatar = useServerFn(uploadAvatarFn);
  const checkHandle = useServerFn(checkHandleAvailabilityFn);

  const displayNameId = useId();
  const bioId = useId();
  const handleId = useId();
  const handleHintId = useId();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [displayName, setDisplayName] = useState(profile.displayName);
  const [bio, setBio] = useState(profile.bio);
  const [handle, setHandle] = useState(profile.handle ?? "");

  const [avatarUrl, setAvatarUrl] = useOptimistic(
    profile.avatarUrl,
    (_current: string | null, next: string | null) => next,
  );
  const [isAvatarPending, startAvatarTransition] = useTransition();
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const [handleHint, setHandleHint] = useState<HandleHint>({ kind: "idle" });

  const dirty =
    displayName !== profile.displayName ||
    bio !== profile.bio ||
    handle !== (profile.handle ?? "");

  const reconcile = () =>
    router.invalidate().catch(() => {
      console.error("Profile reconcile failed");
    });

  const [saveState, save, isSaving] = useActionState(
    async (_previous: SaveState, formData: FormData): Promise<SaveState> => {
      const nextHandle = String(formData.get("handle") ?? "");
      try {
        await updateProfile({
          data: {
            displayName: String(formData.get("displayName") ?? ""),
            bio: String(formData.get("bio") ?? ""),
            handle: nextHandle,
          },
        });
      } catch (error) {
        return {
          status: "error",
          message: displayError(error),
          suggestions: suggestionsFor(nextHandle, error),
        };
      }
      await reconcile();
      return { status: "saved", message: null, suggestions: [] };
    },
    IDLE_SAVE_STATE,
  );

  // ハンドルの可否は目安。確定するのは保存時の予約なので、ここでの
  // 「使用できます」は送信可否を左右しない。
  useEffect(() => {
    const candidate = handle.trim();
    if (candidate === "" || candidate === (profile.handle ?? "")) {
      setHandleHint({ kind: "idle" });
      return;
    }
    setHandleHint({ kind: "checking" });
    let cancelled = false;
    const timer = setTimeout(() => {
      checkHandle({ data: { handle: candidate } })
        .then((view) => {
          if (cancelled) return;
          setHandleHint(
            view.available
              ? { kind: "available" }
              : {
                  kind: "problem",
                  message: "このハンドルは使われています",
                },
          );
        })
        .catch((error: unknown) => {
          if (cancelled) return;
          setHandleHint({ kind: "problem", message: displayError(error) });
        });
    }, HANDLE_CHECK_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [handle, profile.handle, checkHandle]);

  const onPickFile = (file: File) => {
    if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
      setAvatarError(
        "アイコンに使えるのは PNG / JPEG / WebP です。形式を変えてからお試しください。",
      );
      return;
    }
    if (file.size > AVATAR_MAX_BYTES) {
      setAvatarError(
        "アイコンは 5 MB までです。小さい画像にしてからお試しください。",
      );
      return;
    }
    const preview = URL.createObjectURL(file);
    startAvatarTransition(async () => {
      setAvatarUrl(preview);
      try {
        const body = new FormData();
        body.set("file", file);
        const { url } = await uploadAvatar({ data: body });
        // 2 段目。ここまで通って初めてプロフィールに残る。
        await updateProfile({ data: { avatarUrl: url } });
      } catch (error) {
        setAvatarError(displayError(error));
        URL.revokeObjectURL(preview);
        return;
      }
      setAvatarError(null);
      await reconcile();
      URL.revokeObjectURL(preview);
    });
  };

  const onRemoveAvatar = () => {
    startAvatarTransition(async () => {
      setAvatarUrl(null);
      try {
        await updateProfile({ data: { avatarUrl: null } });
      } catch (error) {
        setAvatarError(displayError(error));
        return;
      }
      setAvatarError(null);
      await reconcile();
    });
  };

  const onReset = () => {
    setDisplayName(profile.displayName);
    setBio(profile.bio);
    setHandle(profile.handle ?? "");
    setHandleHint({ kind: "idle" });
  };

  const handleProblem =
    saveState.status === "error" && saveState.suggestions.length > 0
      ? saveState.message
      : handleHint.kind === "problem"
        ? handleHint.message
        : null;

  return (
    <form action={save}>
      <section className={panelClass}>
        <h2 className={panelTitleClass}>公開プロフィール</h2>
        <p className={panelNoteClass}>公開ノートと公開ページに表示されます。</p>

        <div className="mb-5">
          <span className={fieldLabelClass}>アイコン</span>
          <div className="flex flex-wrap items-center gap-4">
            <Avatar url={avatarUrl} displayName={displayName} />
            <input
              ref={fileInputRef}
              type="file"
              className="sr-only"
              accept={ACCEPTED_IMAGE_TYPES.join(",")}
              onChange={(event) => {
                const file = event.target.files?.[0];
                // 同じファイルを選び直せるように毎回空へ戻す。
                event.target.value = "";
                if (file !== undefined) onPickFile(file);
              }}
            />
            <button
              type="button"
              className={subtleButtonClass}
              disabled={isAvatarPending}
              aria-busy={isAvatarPending}
              onClick={() => fileInputRef.current?.click()}
            >
              {isAvatarPending ? "アップロード中..." : "画像を選ぶ"}
            </button>
            {avatarUrl === null ? null : (
              <button
                type="button"
                className={ghostButtonClass}
                disabled={isAvatarPending}
                onClick={onRemoveAvatar}
              >
                削除
              </button>
            )}
            <span className="text-xs text-ink-tertiary">
              PNG / JPEG / WebP · 5 MB まで
            </span>
          </div>
          <p className={errorTextClass} role="status" aria-live="polite">
            {avatarError}
          </p>
        </div>

        <div className="mb-5">
          <label className={fieldLabelClass} htmlFor={displayNameId}>
            表示名
          </label>
          <input
            id={displayNameId}
            name="displayName"
            type="text"
            className={inputClass}
            maxLength={DISPLAY_NAME_MAX_LENGTH}
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
          />
        </div>

        <div>
          <label className={fieldLabelClass} htmlFor={bioId}>
            自己紹介
          </label>
          <textarea
            id={bioId}
            name="bio"
            className={`${inputClass} h-auto min-h-22 resize-y py-3 leading-normal`}
            maxLength={BIO_MAX_LENGTH}
            placeholder="どんなものを公開しているか、ひとことで"
            value={bio}
            onChange={(event) => setBio(event.target.value)}
          />
          <p className="mt-2 text-xs text-ink-tertiary">
            {BIO_MAX_LENGTH} 文字まで
          </p>
        </div>
      </section>

      <section className={panelClass}>
        <h2 className={panelTitleClass}>公開ハンドル</h2>
        <p className={panelNoteClass}>
          公開ページの URL になります。公開ノートを持つには設定が必要です。
        </p>

        {profile.handle === null ? null : (
          <div
            role="note"
            className="mb-5 flex items-start gap-3 rounded-md border border-warning/30 px-4 py-3 shadow-xs"
          >
            <WarningIcon />
            <div>
              <div className="mb-0.5 text-sm font-semibold text-warning">
                ハンドルを変えると古い URL は開けなくなります
              </div>
              <div className="text-sm text-ink-secondary">
                共有済みのリンクや検索エンジンの登録もたどれなくなります。変更前の
                URL は他の人が使えるようになります。
              </div>
            </div>
          </div>
        )}

        <div>
          <label className={fieldLabelClass} htmlFor={handleId}>
            ハンドル
          </label>
          <div className="flex items-center">
            <span className="inline-flex h-11 items-center rounded-l-md border border-hairline-strong border-r-0 bg-surface px-3 text-sm whitespace-nowrap text-ink-tertiary">
              {handlePrefix}
            </span>
            <input
              id={handleId}
              name="handle"
              type="text"
              autoComplete="off"
              spellCheck={false}
              className={`${inputClass} rounded-l-none ${
                handleProblem === null ? "" : inputInvalidClass
              }`}
              value={handle}
              aria-describedby={handleHintId}
              aria-invalid={handleProblem !== null}
              onChange={(event) => setHandle(event.target.value)}
            />
          </div>
          <p id={handleHintId} aria-live="polite" className="empty:hidden">
            {handleProblem !== null ? (
              <span className={fieldErrorClass}>{handleProblem}</span>
            ) : handleHint.kind === "available" ? (
              <span className="mt-2 inline-block text-xs text-success">
                このハンドルは使用できます
              </span>
            ) : handleHint.kind === "checking" ? (
              <span className="mt-2 inline-block text-xs text-ink-tertiary">
                確認中...
              </span>
            ) : null}
          </p>
          {saveState.suggestions.length === 0 ? null : (
            <div className="mt-2 flex flex-wrap gap-2">
              {saveState.suggestions.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  className="h-6.5 rounded-pill bg-surface px-3 text-xs text-ink-secondary transition-colors hover:bg-surface-hover hover:text-ink"
                  onClick={() => setHandle(suggestion)}
                >
                  {suggestion}
                </button>
              ))}
            </div>
          )}
          <p className="mt-2 text-xs text-ink-tertiary">
            空欄にすると公開ハンドルを解除します。
          </p>
        </div>
      </section>

      <div className="sticky bottom-0 z-50 -mx-4 border-t border-hairline bg-[var(--bar-bg)] px-4 py-2 backdrop-blur-xl backdrop-saturate-150 sm:-mx-6 sm:px-6">
        <div className="mx-auto flex max-w-[var(--list-max)] items-center gap-2">
          <span className="text-xs text-ink-tertiary" role="status">
            {isSaving
              ? "保存中..."
              : saveState.status === "saved"
                ? "保存しました"
                : dirty
                  ? "未保存の変更があります"
                  : null}
          </span>
          <div className="flex-1" />
          <button
            type="button"
            className={ghostButtonClass}
            disabled={!dirty || isSaving}
            onClick={onReset}
          >
            変更を取り消す
          </button>
          <button
            type="submit"
            className={primaryButtonClass}
            disabled={!dirty || isSaving}
            aria-busy={isSaving}
          >
            保存
          </button>
        </div>
        <p className={errorTextClass} role="status" aria-live="polite">
          {saveState.status === "error" && saveState.suggestions.length === 0
            ? saveState.message
            : null}
        </p>
      </div>
    </form>
  );
}

function Avatar({
  url,
  displayName,
}: {
  url: string | null;
  displayName: string;
}) {
  if (url !== null) {
    return (
      <img
        src={url}
        alt=""
        width={64}
        height={64}
        className="size-16 shrink-0 rounded-full object-cover"
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      className="inline-flex size-16 shrink-0 items-center justify-center rounded-full bg-linear-135 from-[#c9d3df] to-[#8e99a8] text-lg font-medium text-bg"
    >
      {displayName.trim().slice(0, 2) || "?"}
    </span>
  );
}

/**
 * 重複したときだけ出す代案。ハンドルは 30 文字までなので、接尾辞の分を
 * 削ってから足す。
 */
function suggestionsFor(handle: string, error: unknown): readonly string[] {
  if (extractSerializedError(error).code !== "HANDLE_ALREADY_USED") {
    return [];
  }
  const suffixes = ["-1", "-2", `-${new Date().getFullYear() % 100}`];
  const base = handle.trim().toLowerCase();
  return suffixes.map(
    (suffix) => `${base.slice(0, 30 - suffix.length)}${suffix}`,
  );
}

function WarningIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      aria-hidden="true"
      className="mt-0.5 shrink-0 text-warning"
    >
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}
