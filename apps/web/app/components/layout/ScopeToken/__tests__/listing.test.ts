import type { UserWorkspaceView } from "@repo/core/application/workspace/view";
import { describe, expect, it } from "vitest";
import {
  appendPage,
  beginLoad,
  failLoad,
  IDLE_LISTING,
  type Listing,
  shouldLoadOnOpen,
} from "../listing";

const workspace = (workspaceId: string, name: string): UserWorkspaceView => ({
  status: "active",
  workspaceId,
  name,
  slug: null,
  avatarUrl: null,
  role: "owner",
  publication: "private",
});

const loadedWith = (
  items: readonly UserWorkspaceView[],
  nextCursor: string | null,
): Listing => appendPage(IDLE_LISTING, { workspaces: items, nextCursor }, null);

describe("shouldLoadOnOpen", () => {
  it("retries after a first fetch that failed", () => {
    expect(shouldLoadOnOpen(IDLE_LISTING)).toBe(true);
    expect(shouldLoadOnOpen({ kind: "failed", message: "落ちました" })).toBe(
      true,
    );
  });

  it("does not refetch a list that is already there or in flight", () => {
    expect(shouldLoadOnOpen({ kind: "loading" })).toBe(false);
    expect(
      shouldLoadOnOpen(loadedWith([workspace("ws_a", "設計")], null)),
    ).toBe(false);
  });
});

describe("beginLoad", () => {
  it("keeps the visible list and clears the error while the next page is in flight", () => {
    const failed = failLoad(
      loadedWith([workspace("ws_a", "設計")], "cursor_1"),
      "読み込みに失敗しました",
    );

    const retrying = beginLoad(failed);

    expect(retrying).toEqual({
      kind: "loaded",
      items: [workspace("ws_a", "設計")],
      nextCursor: "cursor_1",
      pending: true,
      error: null,
    });
  });

  it("shows the whole-list spinner only when nothing is displayed yet", () => {
    expect(beginLoad(IDLE_LISTING)).toEqual({ kind: "loading" });
    expect(beginLoad({ kind: "failed", message: "落ちました" })).toEqual({
      kind: "loading",
    });
  });
});

describe("appendPage", () => {
  it("appends a cursored page instead of replacing the list", () => {
    const first = loadedWith([workspace("ws_a", "設計")], "cursor_1");

    const second = appendPage(
      first,
      { workspaces: [workspace("ws_b", "広報")], nextCursor: null },
      "cursor_1",
    );

    expect(second).toEqual({
      kind: "loaded",
      items: [workspace("ws_a", "設計"), workspace("ws_b", "広報")],
      nextCursor: null,
      pending: false,
      error: null,
    });
  });

  it("replaces the list when the first page is fetched again", () => {
    const first = loadedWith([workspace("ws_a", "設計")], "cursor_1");

    const refetched = appendPage(
      first,
      { workspaces: [workspace("ws_b", "広報")], nextCursor: null },
      null,
    );

    expect(refetched).toEqual({
      kind: "loaded",
      items: [workspace("ws_b", "広報")],
      nextCursor: null,
      pending: false,
      error: null,
    });
  });
});

describe("failLoad", () => {
  it("keeps the displayed list and attaches the message", () => {
    const loaded = loadedWith([workspace("ws_a", "設計")], "cursor_1");

    expect(failLoad(loaded, "落ちました")).toEqual({
      kind: "loaded",
      items: [workspace("ws_a", "設計")],
      nextCursor: "cursor_1",
      pending: false,
      error: "落ちました",
    });
  });

  it("falls to the terminal state only when nothing was displayed", () => {
    expect(failLoad({ kind: "loading" }, "落ちました")).toEqual({
      kind: "failed",
      message: "落ちました",
    });
  });
});
