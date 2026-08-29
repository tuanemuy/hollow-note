"use client";

import { Link, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState, useTransition } from "react";
import { displayError } from "@/presentation/errorDisplay";
import { listMyWorkspacesFn, selectScopeFn } from "./action";
import {
  appendPage,
  beginLoad,
  failLoad,
  IDLE_LISTING,
  type Listing,
  shouldLoadOnOpen,
} from "./listing";

/**
 * L-01 スコープトークン（spec/pages/index.md#L-01、WS-02）。
 *
 * 「今どこにいるか」の唯一の表示なので常に出す。開くと個人と参加中の
 * ワークスペースが並び、選ぶとその文脈へ遷移する。一覧は開いた時点で
 * 初めて取りに行き、20 件ずつ足す（`listUserWorkspaces` のページ）。
 *
 * 切り替えは 2 つのことを同時に満たす。**URL を差し替える**（文脈は URL が
 * 正本）ことと、**検索語・タグ・月の絞り込みを持ち越さない**こと — タグは
 * 文脈ごとに独立しているので、遷移先の検索パラメータを空にして渡す。
 * 次回訪問への引き継ぎは `selectScopeFn` が書く Cookie が担う。
 */
export type ShellScope =
  | Readonly<{ kind: "personal" }>
  | Readonly<{
      kind: "workspace";
      workspaceId: string;
      name: string;
      slug: string | null;
      publication: "private" | "published";
    }>;

export const PERSONAL_SHELL_SCOPE: ShellScope = { kind: "personal" };

const initials = (name: string): string => name.trim().slice(0, 2) || "?";

export function ScopeToken({ scope }: { scope: ShellScope }) {
  const router = useRouter();
  const selectScope = useServerFn(selectScopeFn);
  const listWorkspaces = useServerFn(listMyWorkspacesFn);

  const [open, setOpen] = useState(false);
  const [listing, setListing] = useState<Listing>(IDLE_LISTING);
  const [isSwitching, startSwitching] = useTransition();
  const [switchError, setSwitchError] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const load = (cursor: string | null) => {
    setListing(beginLoad);
    listWorkspaces({ data: { cursor } })
      .then((page) => {
        setListing((current) => appendPage(current, page, cursor));
      })
      .catch((error: unknown) => {
        const message = displayError(error);
        setListing((current) => failLoad(current, message));
      });
  };

  const onToggle = () => {
    if (!open && shouldLoadOnOpen(listing)) load(null);
    setOpen((value) => !value);
  };

  const switchTo = (next: ShellScope) => {
    setSwitchError(null);
    startSwitching(async () => {
      try {
        await selectScope({
          data: {
            workspaceId: next.kind === "personal" ? null : next.workspaceId,
          },
        });
      } catch (error) {
        setSwitchError(displayError(error));
        return;
      }
      setOpen(false);
      await (next.kind === "personal"
        ? router.navigate({ to: "/notes", search: {} })
        : router.navigate({
            to: "/workspaces/$workspaceId/notes",
            params: { workspaceId: next.workspaceId },
            search: {},
          }));
    });
  };

  const label = scope.kind === "personal" ? "個人" : scope.name;

  return (
    <div ref={rootRef} className="relative min-w-0">
      {/* AccountMenu と同じ disclosure。ARIA の menu ロールは矢印キーでの
          フォーカス移動まで約束してしまうので使わない。 */}
      <button
        type="button"
        aria-expanded={open}
        aria-busy={isSwitching}
        onClick={onToggle}
        className="inline-flex h-[30px] max-w-[46vw] min-w-0 items-center gap-1 rounded-pill bg-surface pr-2 pl-[5px] text-sm transition-colors hover:bg-surface-hover"
      >
        <span className="sr-only">現在のスコープ:</span>
        <span
          aria-hidden="true"
          className="inline-flex size-5 shrink-0 items-center justify-center rounded-sm bg-ink-secondary text-[9px] font-medium text-bg"
        >
          {scope.kind === "personal" ? "個" : initials(scope.name)}
        </span>
        <span className="truncate">{label}</span>
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          className="shrink-0 text-ink-tertiary"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open ? (
        <div className="absolute top-full left-0 z-50 mt-2 max-h-[70vh] w-72 overflow-y-auto rounded-lg border border-hairline bg-bg py-2 shadow-sm">
          <div className="px-4 py-1.5 text-xs text-ink-tertiary">文脈</div>
          <ScopeChoice
            label="個人"
            badge="個"
            current={scope.kind === "personal"}
            disabled={isSwitching}
            onSelect={() => switchTo({ kind: "personal" })}
          />
          {listing.kind === "loaded"
            ? listing.items.map((workspace) =>
                workspace.status === "active" ? (
                  <ScopeChoice
                    key={workspace.workspaceId}
                    label={workspace.name}
                    badge={initials(workspace.name)}
                    current={
                      scope.kind === "workspace" &&
                      scope.workspaceId === workspace.workspaceId
                    }
                    disabled={isSwitching}
                    onSelect={() =>
                      switchTo({
                        kind: "workspace",
                        workspaceId: workspace.workspaceId,
                        name: workspace.name,
                        slug: workspace.slug,
                        publication: workspace.publication,
                      })
                    }
                  />
                ) : (
                  // 一時的に読めないだけの行を落とすと、短い障害が「除名
                  // された」ように見える。並べたまま選べなくする。
                  <div
                    key={workspace.workspaceId}
                    className="px-4 py-2 text-sm text-ink-tertiary"
                  >
                    読み込めないワークスペースがあります
                  </div>
                ),
              )
            : null}
          {listing.kind === "loading" ? (
            <div className="px-4 py-2 text-sm text-ink-tertiary" role="status">
              読み込み中...
            </div>
          ) : null}
          {listing.kind === "failed" ? (
            <>
              <p className="px-4 py-2 text-xs text-error" role="status">
                {listing.message}
              </p>
              <LoadMoreChoice
                pending={false}
                retry={true}
                onSelect={() => load(null)}
              />
            </>
          ) : null}
          {listing.kind === "loaded" && listing.error !== null ? (
            <p className="px-4 py-2 text-xs text-error" role="status">
              {listing.error}
            </p>
          ) : null}
          {listing.kind === "loaded" && listing.nextCursor !== null ? (
            <LoadMoreChoice
              pending={listing.pending}
              retry={listing.error !== null}
              onSelect={() => load(listing.nextCursor)}
            />
          ) : null}

          <div className="my-2 border-t border-hairline" />
          <Link
            to="/workspaces/new"
            onClick={() => setOpen(false)}
            className="block px-4 py-2 text-sm text-ink transition-colors hover:bg-surface"
          >
            ワークスペースを作成
          </Link>

          {/* 現在の文脈の行き先。権限や状態で使えないものは並べずに消す
              （L-01「使えない行き先は並べずに消す」）。タグ管理・ゴミ箱は
              対応画面が別スライスなので置かない。 */}
          {scope.kind === "workspace" ? (
            <>
              <div className="my-2 border-t border-hairline" />
              <Link
                to="/workspaces/$workspaceId/settings/general"
                params={{ workspaceId: scope.workspaceId }}
                onClick={() => setOpen(false)}
                className="block px-4 py-2 text-sm text-ink transition-colors hover:bg-surface"
              >
                ワークスペース設定
              </Link>
              {scope.publication === "published" && scope.slug !== null ? (
                <a
                  href={`/w/${scope.slug}`}
                  className="block px-4 py-2 text-sm text-ink transition-colors hover:bg-surface"
                >
                  公開ページを開く
                </a>
              ) : null}
            </>
          ) : null}

          <p className="px-4 text-xs text-error not-empty:py-1.5" role="status">
            {switchError}
          </p>
        </div>
      ) : null}
    </div>
  );
}

function LoadMoreChoice({
  pending,
  retry,
  onSelect,
}: {
  pending: boolean;
  retry: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      disabled={pending}
      aria-busy={pending}
      onClick={onSelect}
      className="block w-full px-4 py-2 text-left text-sm text-ink-secondary transition-colors hover:bg-surface hover:text-ink disabled:opacity-55"
    >
      {pending
        ? "読み込み中..."
        : retry
          ? "もう一度読み込む"
          : "さらに読み込む"}
    </button>
  );
}

function ScopeChoice({
  label,
  badge,
  current,
  disabled,
  onSelect,
}: {
  label: string;
  badge: string;
  current: boolean;
  disabled: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      aria-current={current ? "true" : undefined}
      onClick={onSelect}
      className={`flex w-full items-center gap-2 px-4 py-2 text-left text-sm transition-colors hover:bg-surface disabled:opacity-55 ${
        current ? "font-medium text-ink" : "text-ink-secondary"
      }`}
    >
      <span
        aria-hidden="true"
        className="inline-flex size-5 shrink-0 items-center justify-center rounded-sm bg-ink-secondary text-[9px] font-medium text-bg"
      >
        {badge}
      </span>
      <span className="truncate">{label}</span>
    </button>
  );
}
