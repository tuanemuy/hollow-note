"use client";

import { useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState, useTransition } from "react";
import { displayError } from "@/presentation/errorDisplay";
import { createBlankNoteFn } from "./action";

/**
 * 白紙ノートの作成トリガー（PAGE-p10-005 の最小形）。作成後は詳細
 * （/notes/$noteId）へ遷移するため一覧の楽観的挿入は行わず、
 * `useTransition` の pending 表示が三層目を担う。
 */
export function CreateNoteButton({
  variant = "primary",
  label = "新規作成",
}: {
  variant?: "primary" | "toolbar";
  label?: string;
}) {
  const navigate = useNavigate();
  const create = useServerFn(createBlankNoteFn);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const onClick = () => {
    startTransition(async () => {
      try {
        const { noteId } = await create({});
        setError(null);
        await navigate({ to: "/notes/$noteId", params: { noteId } });
      } catch (e) {
        setError(displayError(e));
      }
    });
  };

  const className =
    variant === "primary"
      ? "inline-flex h-10 items-center justify-center gap-1.5 rounded-pill bg-accent px-5 text-sm font-medium text-bg transition-colors hover:bg-accent-hover active:bg-accent-pressed disabled:opacity-55"
      : "inline-flex h-[30px] items-center gap-1 rounded-md px-2 text-sm text-ink-secondary transition-colors hover:bg-surface hover:text-ink disabled:opacity-55";

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <button
        type="button"
        onClick={onClick}
        disabled={isPending}
        aria-busy={isPending}
        className={className}
      >
        <svg
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.9"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
        {isPending ? "作成中..." : label}
      </button>
      {error !== null ? (
        <span className="text-xs text-error" aria-live="polite">
          {error}
        </span>
      ) : null}
    </span>
  );
}
