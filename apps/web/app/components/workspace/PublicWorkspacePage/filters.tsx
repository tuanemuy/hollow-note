"use client";

import { useNavigate } from "@tanstack/react-router";
import { useState, useTransition } from "react";

/**
 * P-43 のページ内検索とタグ絞り込み（PAGE-p43-002）。
 *
 * 条件の正本は URL の検索パラメータで、この島は URL を書き換えるだけを
 * 担う。適用中のタグはチップとして積み、チップ自身が解除の入口になる
 * （P-10 のチップ列と同じ扱い）。絞り込みの追加はワークスペース内の
 * タグ facet を要するのでまだ出さない — 供給する読み出しモデルが無い。
 *
 * 遷移は `useTransition` に載せる。入力欄をロックせずに次の結果を待つ
 * ためで、この画面で押せるものがミューテーションを起こさない以上、
 * 三層目の役はここで pending 表示が担う。
 */
export function PublicWorkspaceFilters({
  slug,
  keyword,
  tags,
}: {
  slug: string;
  keyword: string;
  tags: readonly string[];
}) {
  const navigate = useNavigate();
  const [draft, setDraft] = useState(keyword);
  const [appliedKeyword, setAppliedKeyword] = useState(keyword);
  const [isPending, startTransition] = useTransition();

  // 検索パラメータだけが変わるナビゲーション（戻る / 進む、`?q=` 付きの
  // リンク）ではこの島が同じ位置に再利用されるので、`useState` の初期値は
  // もう読まれない。正本（URL）が動いたことを検知して入力欄を追従させる
  // — `key` で作り直すと確定のたびに入力欄がアンマウントされ、
  // `useTransition` 中の焦点が飛ぶ。
  if (appliedKeyword !== keyword) {
    setAppliedKeyword(keyword);
    setDraft(keyword);
  }

  const apply = (next: { keyword?: string; tags?: readonly string[] }) => {
    const nextKeyword = (next.keyword ?? keyword).trim();
    const nextTags = next.tags ?? tags;
    startTransition(async () => {
      await navigate({
        to: "/w/$slug",
        params: { slug },
        search: {
          q: nextKeyword.length === 0 ? undefined : nextKeyword,
          tags: nextTags.length === 0 ? undefined : [...nextTags],
        },
      }).catch(() => {
        console.error("Navigation to the filtered public workspace failed");
      });
    });
  };

  return (
    <div className="mb-6 flex flex-wrap items-center gap-2">
      <search className="relative min-w-[200px] flex-1">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            apply({ keyword: draft });
          }}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-tertiary"
          >
            <circle cx="11" cy="11" r="7" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="search"
            value={draft}
            aria-label="このページ内で検索"
            placeholder="このページ内で検索"
            aria-busy={isPending}
            onChange={(event) => setDraft(event.target.value)}
            className="h-9 w-full rounded-pill bg-surface pr-4 pl-[34px] text-sm text-ink transition-colors placeholder:text-ink-tertiary focus:bg-surface-hover"
          />
        </form>
      </search>

      {tags.map((tag) => (
        <button
          key={tag}
          type="button"
          aria-pressed="true"
          disabled={isPending}
          onClick={() => apply({ tags: tags.filter((name) => name !== tag) })}
          className="inline-flex h-[30px] items-center gap-1 rounded-pill bg-ink px-3 text-sm text-bg transition-colors disabled:opacity-55"
        >
          #{tag}
          <span className="sr-only">の絞り込みを解除</span>
          <svg
            width="12"
            height="12"
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
        </button>
      ))}

      {keyword.length > 0 || tags.length > 0 ? (
        <button
          type="button"
          disabled={isPending}
          onClick={() => {
            setDraft("");
            apply({ keyword: "", tags: [] });
          }}
          className="inline-flex h-[30px] items-center rounded-pill px-3 text-sm text-ink-secondary transition-colors hover:bg-surface hover:text-ink disabled:opacity-55"
        >
          条件を解除
        </button>
      ) : null}
    </div>
  );
}
