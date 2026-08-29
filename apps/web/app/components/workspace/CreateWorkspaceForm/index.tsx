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
import { slugSuggestionsFor } from "@/components/workspace/slugSuggestions";
import { renderErrorMessage } from "@/presentation/errorDisplay";
import { extractSerializedError } from "@/presentation/errorResponse";
import { createWorkspaceFn } from "@/routes/workspaces/-action";

/**
 * P-30 ワークスペース作成（モック P30-workspace-new.html、
 * PAGE-p30-001..002）。
 *
 * 作成に成功したらそのワークスペースの文脈へ移る（WS-01 手順 4）。
 * スラッグの重複は**入力中には検出しない** — 可否を判定する読み取り
 * ユースケースがまだ無く、確定するのは作成時の予約なので、拒否された
 * ときにその場で代替候補を出す形にしてある。
 */

const SLUG_FIELD_CODES: ReadonlySet<string> = new Set([
  "SLUG_ALREADY_USED",
  WorkspaceErrorCode.InvalidSlug,
  WorkspaceErrorCode.SlugReserved,
]);

type CreateError = Readonly<{
  target: "name" | "slug" | "form";
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
      message,
      suggestions: code === "SLUG_ALREADY_USED" ? slugSuggestionsFor(slug) : [],
    };
  }
  if (code === WorkspaceErrorCode.InvalidName) {
    return { target: "name", message, suggestions: [] };
  }
  return { target: "form", message, suggestions: [] };
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
        to: "/workspaces/$workspaceId/settings/general",
        params: { workspaceId },
      });
      return IDLE;
    },
    IDLE,
  );

  const failure = state.error;
  const nameError = failure?.target === "name" ? failure.message : null;
  const slugError = failure?.target === "slug" ? failure.message : null;

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
          <p className={fieldErrorClass} id={slugErrorId} aria-live="polite">
            {slugError}
          </p>
          {failure !== null && failure.suggestions.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-2">
              {failure.suggestions.map((suggestion) => (
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
