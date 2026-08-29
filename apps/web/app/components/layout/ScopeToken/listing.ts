import type { UserWorkspaceView } from "@repo/core/application/workspace/view";

/**
 * スコープトークンの一覧状態と、その畳み込み（L-01、WS-02）。
 *
 * コンポーネントから分けてあるのは、DOM もサーバー関数のランタイムも
 * 無しでこの遷移を単体テストできる形に保つため（`presentation/scope.ts`
 * と同じ理由）。
 *
 * 追加読み込みの失敗は `loaded` に添える。差し替えてしまうと、1 回の失敗で
 * すでに表示していた一覧が消えて「今どこにいるか」の唯一の入口が空になる。
 */
export type Listing =
  | Readonly<{ kind: "idle" }>
  | Readonly<{ kind: "loading" }>
  | Readonly<{
      kind: "loaded";
      items: readonly UserWorkspaceView[];
      nextCursor: string | null;
      pending: boolean;
      error: string | null;
    }>
  | Readonly<{ kind: "failed"; message: string }>;

export type WorkspacePage = Readonly<{
  workspaces: readonly UserWorkspaceView[];
  nextCursor: string | null;
}>;

export const IDLE_LISTING: Listing = { kind: "idle" };

/**
 * 開いた時点で取りに行くかどうか。`failed` を含めるのは、初回取得に
 * 失敗したあと `idle` へ戻る経路が無く、閉じて開き直しても状態が残る
 * ため — 含めないとその一枚で WS-02 の入口が死ぬ。`NoteMovePicker` は
 * 閉じるたびにアンマウントされるので同じ穴が無い。
 */
export function shouldLoadOnOpen(listing: Listing): boolean {
  return listing.kind === "idle" || listing.kind === "failed";
}

export function beginLoad(current: Listing): Listing {
  return current.kind === "loaded"
    ? { ...current, pending: true, error: null }
    : { kind: "loading" };
}

/** `cursor` が `null` のページは先頭ページなので置き換え、以降は追記する。 */
export function appendPage(
  current: Listing,
  page: WorkspacePage,
  cursor: string | null,
): Listing {
  return {
    kind: "loaded",
    items:
      current.kind === "loaded" && cursor !== null
        ? [...current.items, ...page.workspaces]
        : page.workspaces,
    nextCursor: page.nextCursor,
    pending: false,
    error: null,
  };
}

export function failLoad(current: Listing, message: string): Listing {
  return current.kind === "loaded"
    ? { ...current, pending: false, error: message }
    : { kind: "failed", message };
}
