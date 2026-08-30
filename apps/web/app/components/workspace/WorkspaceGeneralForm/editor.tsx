"use client";

import type { WorkspaceSettingsView } from "@repo/core/application/workspace/view";
import { StorageErrorCode } from "@repo/core/domain/storage/errorCode";
import {
  AVATAR_ALLOWED_MIME_TYPES,
  AVATAR_MAX_BYTES,
} from "@repo/core/domain/storage/services/uploadValidationPolicy";
import { useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  useActionState,
  useId,
  useOptimistic,
  useRef,
  useState,
  useTransition,
} from "react";
import {
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
import { Alert } from "@/components/ui/Alert";
import {
  WORKSPACE_DESCRIPTION_MAX_LENGTH,
  WORKSPACE_NAME_MAX_LENGTH,
  WORKSPACE_SLUG_HINT,
  WORKSPACE_SLUG_MAX_LENGTH,
} from "@/components/workspace/schema";
import { useSlugAvailability } from "@/components/workspace/slugAvailability";
import { displayError, renderErrorMessage } from "@/presentation/errorDisplay";
import {
  changeWorkspaceSlugFn,
  updateWorkspaceProfileFn,
  uploadWorkspaceAvatarFn,
} from "@/routes/workspaces/$workspaceId/settings/-action";
import {
  IDLE_SAVE_STATE,
  type SaveOutcome,
  type SaveState,
  saveOutcome,
} from "./save";

/**
 * P-31 の編集を持つ島（PAGE-p31-001..004）。
 *
 * 名前・説明・スラッグは 1 つの保存バーで確定するが、**ユースケースは
 * 2 つ**（`updateWorkspaceProfile` と `changeWorkspaceSlug`）なので、
 * 変わった側だけを順に呼ぶ。スラッグの交換は global な予約サガなので、
 * プロフィールの保存が落ちた時点で止める — 名前が保存できていないのに
 * 公開 URL だけ変わる状態を作らないため。
 *
 * アイコンだけは別の操作で、選んだ時点で `storeAvatar` →
 * `updateWorkspaceProfile` の 2 段を走らせる（`storeAvatar` は
 * ワークスペースを書かないので、2 段目が無いと保管だけ成功して表示に出ない）。
 */

const AVATAR_MAX_MEGABYTES = AVATAR_MAX_BYTES / (1024 * 1024);

/**
 * 大きすぎるファイルだけは送る前に止める。しきい値も文言も判定側と同じ
 * 出所から引くので、ドメインが上限を変えれば追随する。形式の判定はバイト列の
 * 署名で行われるため先回りしない — `accept` は選択の目安。
 */
const OVERSIZE_MESSAGE = renderErrorMessage({
  kind: "business",
  code: StorageErrorCode.FileTooLarge,
  message: "",
});

export function WorkspaceGeneralEditor({
  workspace,
  slugPrefix,
}: {
  workspace: WorkspaceSettingsView;
  slugPrefix: string;
}) {
  const router = useRouter();
  const updateProfile = useServerFn(updateWorkspaceProfileFn);
  const changeSlug = useServerFn(changeWorkspaceSlugFn);
  const uploadAvatar = useServerFn(uploadWorkspaceAvatarFn);

  const nameId = useId();
  const descriptionId = useId();
  const slugId = useId();
  const slugHintId = useId();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [name, setName] = useState(workspace.name);
  const [description, setDescription] = useState(workspace.description);
  const [slug, setSlug] = useState(workspace.slug ?? "");

  const [avatarUrl, setAvatarUrl] = useOptimistic(
    workspace.avatarUrl,
    (_current: string | null, next: string | null) => next,
  );
  const [isAvatarPending, startAvatarTransition] = useTransition();
  const [avatarError, setAvatarError] = useState<string | null>(null);

  const readOnly = !workspace.canManage;
  const dirty =
    name !== workspace.name ||
    description !== workspace.description ||
    slug !== (workspace.slug ?? "");

  const reconcile = () =>
    router.invalidate().catch(() => {
      console.error("Workspace settings reconcile failed");
    });

  const settle = async (outcome: SaveOutcome): Promise<SaveState> => {
    if (outcome.reconcile) await reconcile();
    return outcome.state;
  };

  const [saveState, save, isSaving] = useActionState(
    async (_previous: SaveState, formData: FormData): Promise<SaveState> => {
      const submitted = {
        name: String(formData.get("name") ?? ""),
        description: String(formData.get("description") ?? ""),
        slug: String(formData.get("slug") ?? ""),
      };
      const profileChanged =
        submitted.name !== workspace.name ||
        submitted.description !== workspace.description;
      const slugChanged = submitted.slug !== (workspace.slug ?? "");
      let committed = false;

      if (profileChanged) {
        try {
          const saved = await updateProfile({
            data: {
              workspaceId: workspace.workspaceId,
              name: submitted.name,
              description: submitted.description,
            },
          });
          committed = true;
          // サーバー側の正規化（`WorkspaceName.create` の trim）で値が変わると
          // 送った値のまま残るローカル状態は永久に未保存扱いになる。保存中に
          // 打ち替えた欄まで巻き戻さないよう、送った値がそのまま残っている
          // 欄だけを種まき直す。
          setName((current) =>
            current === submitted.name ? saved.name : current,
          );
          setDescription((current) =>
            current === submitted.description ? saved.description : current,
          );
        } catch (error) {
          return settle(
            saveOutcome(committed, { slug: submitted.slug, error }),
          );
        }
      }

      if (slugChanged) {
        try {
          const changed = await changeSlug({
            data: {
              workspaceId: workspace.workspaceId,
              slug: submitted.slug,
            },
          });
          committed = true;
          setSlug((current) =>
            current === submitted.slug ? (changed.slug ?? "") : current,
          );
        } catch (error) {
          return settle(
            saveOutcome(committed, { slug: submitted.slug, error }),
          );
        }
      }

      return settle(saveOutcome(committed, null));
    },
    IDLE_SAVE_STATE,
  );

  const onPickFile = (file: File) => {
    if (file.size > AVATAR_MAX_BYTES) {
      setAvatarError(OVERSIZE_MESSAGE);
      return;
    }
    const preview = URL.createObjectURL(file);
    startAvatarTransition(async () => {
      setAvatarUrl(preview);
      try {
        const body = new FormData();
        body.set("file", file);
        body.set("workspaceId", workspace.workspaceId);
        const { url } = await uploadAvatar({ data: body });
        await updateProfile({
          data: { workspaceId: workspace.workspaceId, avatarUrl: url },
        });
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
        await updateProfile({
          data: { workspaceId: workspace.workspaceId, avatarUrl: null },
        });
      } catch (error) {
        setAvatarError(displayError(error));
        return;
      }
      setAvatarError(null);
      await reconcile();
    });
  };

  const onReset = () => {
    setName(workspace.name);
    setDescription(workspace.description);
    setSlug(workspace.slug ?? "");
  };

  // 変更時は自分がいま押さえているスラッグを添える（同じ値の再入力が
  // 自分自身との衝突として返らないようにするため）。
  const slugHint = useSlugAvailability({
    slug,
    current: workspace.slug ?? "",
    workspaceId: workspace.workspaceId,
  });

  const failure = saveState.kind === "error" ? saveState.error : null;
  const nameError = failure?.target === "name" ? failure.message : null;
  const descriptionError =
    failure?.target === "description" ? failure.message : null;
  // スラッグの失敗は、判断の対象になった値が残っているあいだだけ効く。
  const slugFailure =
    failure !== null && failure.target === "slug" && failure.slug === slug
      ? failure
      : null;
  const hintProblem =
    slugHint.kind === "taken" || slugHint.kind === "problem"
      ? slugHint.message
      : null;
  const slugProblem = slugFailure !== null ? slugFailure.message : hintProblem;
  // 実際に予約が落ちた値の候補を、入力中の目安より先に採る。
  const slugSuggestions =
    slugFailure !== null
      ? slugFailure.suggestions
      : slugHint.kind === "taken"
        ? slugHint.suggestions
        : [];

  return (
    <form action={save}>
      {readOnly ? (
        <Alert tone="info" title="読み取り専用です" role="note">
          ワークスペースの設定を変更できるのは owner だけです。
        </Alert>
      ) : null}

      <section className={panelClass}>
        <h2 className={panelTitleClass}>基本情報</h2>
        <p className={panelNoteClass}>
          メンバーと、公開ページを開いた人に表示されます。
        </p>

        <div className="mb-5">
          <span className={fieldLabelClass}>アイコン</span>
          <div className="flex flex-wrap items-center gap-4">
            <WorkspaceIcon url={avatarUrl} name={name} />
            {/* `hidden` はフォーカス順と支援技術から外すため。`sr-only` だと
                ラベルの無いファイル選択コントロールがもう 1 つ現れる。 */}
            <input
              ref={fileInputRef}
              type="file"
              hidden
              accept={AVATAR_ALLOWED_MIME_TYPES.join(",")}
              onChange={(event) => {
                const file = event.target.files?.[0];
                // 同じファイルを選び直せるように毎回空へ戻す。
                event.target.value = "";
                if (file !== undefined) onPickFile(file);
              }}
            />
            {readOnly ? null : (
              <>
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
              </>
            )}
            <span className="text-xs text-ink-tertiary">
              PNG / JPEG / WebP · {AVATAR_MAX_MEGABYTES} MB まで
            </span>
          </div>
          <p className={errorTextClass} role="status" aria-live="polite">
            {avatarError}
          </p>
        </div>

        <div className="mb-5">
          <label className={fieldLabelClass} htmlFor={nameId}>
            名前
          </label>
          <input
            id={nameId}
            name="name"
            type="text"
            className={`${inputClass} ${nameError === null ? "" : inputInvalidClass}`}
            maxLength={WORKSPACE_NAME_MAX_LENGTH}
            value={name}
            disabled={readOnly}
            aria-invalid={nameError !== null}
            onChange={(event) => setName(event.target.value)}
          />
          <p className={errorTextClass} aria-live="polite">
            {nameError}
          </p>
        </div>

        <div>
          <label className={fieldLabelClass} htmlFor={descriptionId}>
            説明
          </label>
          <textarea
            id={descriptionId}
            name="description"
            className={`${inputClass} h-auto min-h-20 resize-y py-3 leading-normal ${
              descriptionError === null ? "" : inputInvalidClass
            }`}
            maxLength={WORKSPACE_DESCRIPTION_MAX_LENGTH}
            placeholder="どんな資料を集めているか"
            value={description}
            disabled={readOnly}
            aria-invalid={descriptionError !== null}
            onChange={(event) => setDescription(event.target.value)}
          />
          <p className="mt-2 text-xs text-ink-tertiary">
            {WORKSPACE_DESCRIPTION_MAX_LENGTH} 文字まで
          </p>
          <p className={errorTextClass} aria-live="polite">
            {descriptionError}
          </p>
        </div>
      </section>

      <section className={panelClass}>
        <h2 className={panelTitleClass}>公開スラッグ</h2>
        <p className={panelNoteClass}>
          公開ページの URL
          に使います。ワークスペースを公開するには設定が必要です。
        </p>

        {workspace.slug === null ? null : (
          <Alert
            tone="warning"
            role="note"
            title="スラッグを変えると古い URL は開けなくなります"
          >
            公開ページとその中のノートのリンクがすべて変わります。変更前の URL
            は他のワークスペースが使えるようになります。
            {workspace.publication === "published"
              ? "このワークスペースは現在公開中です。"
              : null}
          </Alert>
        )}

        <div>
          <label className={fieldLabelClass} htmlFor={slugId}>
            スラッグ
          </label>
          <div className="flex items-center">
            <span className="inline-flex h-11 items-center rounded-l-md border border-hairline-strong border-r-0 bg-surface px-3 text-sm whitespace-nowrap text-ink-tertiary">
              {slugPrefix}
            </span>
            <input
              id={slugId}
              name="slug"
              type="text"
              autoComplete="off"
              spellCheck={false}
              className={`${inputClass} rounded-l-none ${
                slugProblem === null ? "" : inputInvalidClass
              }`}
              maxLength={WORKSPACE_SLUG_MAX_LENGTH}
              value={slug}
              disabled={readOnly}
              aria-describedby={slugHintId}
              aria-invalid={slugProblem !== null}
              onChange={(event) => setSlug(event.target.value)}
            />
          </div>
          <p
            id={slugHintId}
            className="text-xs not-empty:mt-2"
            aria-live="polite"
          >
            {slugProblem !== null ? (
              <span className="text-error">{slugProblem}</span>
            ) : slugHint.kind === "available" ? (
              <span className="text-success">このスラッグは使用できます</span>
            ) : slugHint.kind === "checking" ? (
              <span className="text-ink-tertiary">確認中...</span>
            ) : null}
          </p>
          {slugSuggestions.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-2">
              {slugSuggestions.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  className="h-6.5 rounded-pill bg-surface px-3 text-xs text-ink-secondary transition-colors hover:bg-surface-hover hover:text-ink"
                  onClick={() => setSlug(suggestion)}
                >
                  {suggestion}
                </button>
              ))}
            </div>
          ) : null}
          <p className="mt-2 text-xs text-ink-tertiary">
            {`${WORKSPACE_SLUG_HINT}。空欄にすると解除します（公開中は解除できません）。`}
          </p>
        </div>
      </section>

      {readOnly ? null : (
        <div className="sticky bottom-0 z-50 -mx-4 border-t border-hairline bg-[var(--bar-bg)] px-4 py-2 backdrop-blur-xl backdrop-saturate-150 sm:-mx-6 sm:px-6">
          <div className="mx-auto flex max-w-[var(--list-max)] items-center gap-2">
            <span className="text-xs text-ink-tertiary" role="status">
              {isSaving
                ? "保存中..."
                : dirty
                  ? "未保存の変更があります"
                  : saveState.kind === "saved"
                    ? "保存しました"
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
            {failure !== null && failure.target === "form"
              ? failure.message
              : null}
          </p>
        </div>
      )}
    </form>
  );
}

function WorkspaceIcon({ url, name }: { url: string | null; name: string }) {
  if (url !== null) {
    return (
      <img
        src={url}
        alt=""
        width={56}
        height={56}
        className="size-14 shrink-0 rounded-lg object-cover"
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      className="inline-flex size-14 shrink-0 items-center justify-center rounded-lg bg-ink text-lg font-medium text-bg"
    >
      {name.trim().slice(0, 2) || "?"}
    </span>
  );
}
