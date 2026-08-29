"use client";

import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { slugSuggestionsFor } from "@/components/workspace/slugSuggestions";
import { displayError, renderErrorMessage } from "@/presentation/errorDisplay";
import { checkWorkspaceSlugAvailabilityFn } from "@/routes/workspaces/-action";

/**
 * P-30 / P-31 のスラッグ欄の入力中の目安（WS-01「スラッグが既に使われて
 * いる場合、入力中に検出して代替候補を示す」、P-30「スラッグ重複の即時
 * 検出」）。両方の画面が同じ判定と同じ候補を出すので 1 か所に置く。
 *
 * 候補を伴えるのは「そのスラッグが埋まっている」と分かった `taken` だけ。
 * 確認そのものが通らなかった経路（予約語・不正な文字・通信断）は
 * `problem` として候補を持てない — そこで候補を出すと、打てない一手を
 * 勧めることになる。
 *
 * 可否は目安であって確定ではない。押さえるのは作成・変更時の予約なので、
 * 「使用できます」は送信可否を左右しない。
 */
export type SlugHint =
  | Readonly<{ kind: "idle" }>
  | Readonly<{ kind: "checking" }>
  | Readonly<{ kind: "available" }>
  | Readonly<{ kind: "taken"; message: string; suggestions: readonly string[] }>
  | Readonly<{ kind: "problem"; message: string }>;

const IDLE: SlugHint = { kind: "idle" };

const SLUG_CHECK_DEBOUNCE_MS = 400;

const TAKEN_MESSAGE = renderErrorMessage({
  kind: "business",
  code: "SLUG_ALREADY_USED",
  message: "",
});

/**
 * @param slug 入力中の値。
 * @param current その画面がいま保存済みとして持っている値（作成画面では
 *   空文字）。一致するあいだは自分自身との衝突なので照会しない。
 * @param workspaceId 変更時（P-31）に自分が押さえているスラッグを
 *   伝えるための ID。作成時（P-30）は `null`。
 */
export function useSlugAvailability({
  slug,
  current,
  workspaceId,
}: {
  slug: string;
  current: string;
  workspaceId: string | null;
}): SlugHint {
  const checkSlug = useServerFn(checkWorkspaceSlugAvailabilityFn);
  const [hint, setHint] = useState<SlugHint>(IDLE);

  useEffect(() => {
    const candidate = slug.trim();
    if (candidate === "" || candidate === current.trim()) {
      setHint(IDLE);
      return;
    }
    setHint({ kind: "checking" });
    let cancelled = false;
    const timer = setTimeout(() => {
      checkSlug({ data: { slug: candidate, workspaceId } })
        .then((view) => {
          if (cancelled) return;
          setHint(
            view.available
              ? { kind: "available" }
              : {
                  kind: "taken",
                  message: TAKEN_MESSAGE,
                  suggestions: slugSuggestionsFor(candidate),
                },
          );
        })
        .catch((error: unknown) => {
          if (cancelled) return;
          setHint({ kind: "problem", message: displayError(error) });
        });
    }, SLUG_CHECK_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [slug, current, workspaceId, checkSlug]);

  return hint;
}
