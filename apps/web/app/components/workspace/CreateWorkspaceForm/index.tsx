"use client";

import { WorkspaceErrorCode } from "@repo/core/domain/workspace/errorCode";
import { useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useActionState, useId, useState } from "react";
import {
  fieldErrorClass,
  fieldLabelClass,
  inputClass,
  inputInvalidClass,
} from "@/components/auth/formStyles";
import {
  ghostButtonClass,
  primaryButtonClass,
} from "@/components/settings/panelStyles";
import { Alert } from "@/components/ui/Alert";
import {
  WORKSPACE_DESCRIPTION_MAX_LENGTH,
  WORKSPACE_NAME_MAX_LENGTH,
  WORKSPACE_SLUG_MAX_LENGTH,
} from "@/components/workspace/schema";
import { useSlugAvailability } from "@/components/workspace/slugAvailability";
import { slugSuggestionsFor } from "@/components/workspace/slugSuggestions";
import { renderErrorMessage } from "@/presentation/errorDisplay";
import { extractSerializedError } from "@/presentation/errorResponse";
import { createWorkspaceFn } from "@/routes/workspaces/-action";

/**
 * P-30 ワークスペース作成（モック P30-workspace-new.html、
 * PAGE-p30-001..002）。
 *
 * 作成に成功したらそのワークスペースの文脈へ移る（WS-01 手順 4）。行き先を
 * メンバー管理（P-32）にするのは、手順 4 が「切り替わり、メンバー招待への
 * 導線が表示される」と定め、P-30 の終状態も「作成完了（招待への導線）」だ
 * からである。招待の入口を持つ画面はここだけなので、ノート一覧へ送ると
 * 導線が消える。
 * スラッグの重複は入力中に照会して代替候補を出す（`useSlugAvailability`）
 * が、確定するのは作成時の予約なので、作成が `SLUG_ALREADY_USED` で
 * 落ちた場合の候補提示も残す。実際に予約が落ちた値の判断のほうが新しい
 * ので、そちらを目安より先に採る。
 */

const SLUG_FIELD_CODES: ReadonlySet<string> = new Set([
  "SLUG_ALREADY_USED",
  WorkspaceErrorCode.InvalidSlug,
  WorkspaceErrorCode.SlugReserved,
]);

type CreateError = Readonly<{
  target: "name" | "slug" | "form";
  /** 判断の対象になった値。入力が変わったら失効させるために持つ。 */
  slug: string;
  message: string;
  suggestions: readonly string[];
}>;

type CreateState = Readonly<{ error: CreateError | null }>;

const IDLE: CreateState = { error: null };

function createErrorFor(slug: string, error: unknown): CreateError {
  const serialized = extractSerializedError(error);
  const message = renderErrorMessage(serialized);
  const code = serialized.code;
  if (code !== null && SLUG_FIELD_CODES.has(code)) {
    return {
      target: "slug",
      slug,
      message,
      suggestions: code === "SLUG_ALREADY_USED" ? slugSuggestionsFor(slug) : [],
    };
  }
  if (code === WorkspaceErrorCode.InvalidName) {
    return { target: "name", slug, message, suggestions: [] };
  }
  return { target: "form", slug, message, suggestions: [] };
}

export function CreateWorkspaceForm({ slugPrefix }: { slugPrefix: string }) {
  const router = useRouter();
  const createWorkspace = useServerFn(createWorkspaceFn);

  const nameId = useId();
  const descriptionId = useId();
  const slugId = useId();
  const slugErrorId = useId();
  const nameErrorId = useId();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [slug, setSlug] = useState("");

  const [state, submit, isPending] = useActionState(
    async (_previous: CreateState): Promise<CreateState> => {
      let workspaceId: string;
      try {
        const view = await createWorkspace({
          data: { name, description, slug },
        });
        workspaceId = view.workspaceId;
      } catch (error) {
        return { error: createErrorFor(slug, error) };
      }
      // 作成は既に成立しているので、遷移の失敗を「作成できなかった」と
      // 見せない（再送で 2 つ目を作らせないため try の外に置く）。
      await router.navigate({
        to: "/workspaces/$workspaceId/settings/members",
        params: { workspaceId },
      });
      return IDLE;
    },
    IDLE,
  );

  const slugHint = useSlugAvailability({
    slug,
    current: "",
    workspaceId: null,
  });

  const failure = state.error;
  const nameError = failure?.target === "name" ? failure.message : null;
  // スラッグの失敗は、判断の対象になった値が残っているあいだだけ効く。
  const slugFailure =
    failure !== null && failure.target === "slug" && failure.slug === slug
      ? failure
      : null;
  const hintProblem =
    slugHint.kind === "taken" || slugHint.kind === "problem"
      ? slugHint.message
      : null;
  const slugError = slugFailure !== null ? slugFailure.message : hintProblem;
  // 実際に予約が落ちた値の候補を、入力中の目安より先に採る。
  const suggestions =
    slugFailure !== null
      ? slugFailure.suggestions
      : slugHint.kind === "taken"
        ? slugHint.suggestions
        : [];

  return (
    <main className="mx-auto max-w-[var(--content-max)] px-4 pt-10 pb-20 sm:px-6 sm:pt-12 lg:pt-16">
      <h1 className="text-3xl font-light tracking-tightest leading-tight">
        ワークスペースを作る
      </h1>
      <p className="mt-3 mb-8 text-sm text-ink-secondary">
        複数人でノートを共有する入れ物です。ノートは個人とワークスペースのあいだで後から移せます。
      </p>

      {failure !== null && failure.target === "form" ? (
        <Alert tone="error" title="作成できませんでした">
          {failure.message}
        </Alert>
      ) : null}

      <form action={submit} noValidate>
        <div className="mb-5">
          <label className={fieldLabelClass} htmlFor={nameId}>
            名前
          </label>
          <input
            id={nameId}
            type="text"
            className={`${inputClass} ${nameError === null ? "" : inputInvalidClass}`}
            maxLength={WORKSPACE_NAME_MAX_LENGTH}
            placeholder="例: デザインチーム"
            value={name}
            disabled={isPending}
            aria-invalid={nameError !== null}
            aria-describedby={nameErrorId}
            onChange={(event) => setName(event.target.value)}
          />
          <p className={fieldErrorClass} id={nameErrorId} aria-live="polite">
            {nameError}
          </p>
        </div>

        <div className="mb-5">
          <label className={fieldLabelClass} htmlFor={descriptionId}>
            説明
            <span className="font-normal text-ink-tertiary">（任意）</span>
          </label>
          <textarea
            id={descriptionId}
            className={`${inputClass} h-auto min-h-20 resize-y py-3 leading-normal`}
            maxLength={WORKSPACE_DESCRIPTION_MAX_LENGTH}
            placeholder="どんな資料を集めるか"
            value={description}
            disabled={isPending}
            onChange={(event) => setDescription(event.target.value)}
          />
        </div>

        <div className="mb-5">
          <label className={fieldLabelClass} htmlFor={slugId}>
            公開スラッグ
            <span className="font-normal text-ink-tertiary">（任意）</span>
          </label>
          <div className="flex items-center">
            <span className="inline-flex h-11 items-center rounded-l-md border border-hairline-strong border-r-0 bg-surface px-3 text-sm whitespace-nowrap text-ink-tertiary">
              {slugPrefix}
            </span>
            <input
              id={slugId}
              type="text"
              autoComplete="off"
              spellCheck={false}
              className={`${inputClass} rounded-l-none ${
                slugError === null ? "" : inputInvalidClass
              }`}
              maxLength={WORKSPACE_SLUG_MAX_LENGTH}
              value={slug}
              disabled={isPending}
              aria-invalid={slugError !== null}
              aria-describedby={slugErrorId}
              onChange={(event) => setSlug(event.target.value)}
            />
          </div>
          <p
            className="text-xs not-empty:mt-2"
            id={slugErrorId}
            aria-live="polite"
          >
            {slugError !== null ? (
              <span className="text-error">{slugError}</span>
            ) : slugHint.kind === "available" ? (
              <span className="text-success">このスラッグは使用できます</span>
            ) : slugHint.kind === "checking" ? (
              <span className="text-ink-tertiary">確認中...</span>
            ) : null}
          </p>
          {suggestions.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-2">
              {suggestions.map((suggestion) => (
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
            半角英小文字・数字・ハイフン。あとから設定できます。ノートを公開するときに必要になります。
          </p>
        </div>

        <div className="mt-8 flex items-center justify-end gap-2">
          <button
            type="button"
            className={ghostButtonClass}
            disabled={isPending}
            onClick={() => router.history.back()}
          >
            キャンセル
          </button>
          <button
            type="submit"
            className={primaryButtonClass}
            disabled={isPending || name.trim() === ""}
            aria-busy={isPending}
          >
            {isPending ? "作成中..." : "作成する"}
          </button>
        </div>
      </form>
    </main>
  );
}
