import { describe, expect, it } from "vitest";
import { appendPage, type Loaded, PERSONAL_LABEL } from "../listing";

const page = (
  targets: readonly { workspaceId: string; name: string }[],
  nextCursor: string | null = null,
) => ({ targets, nextCursor });

describe("appendPage", () => {
  it("drops the current workspace from the first page and keeps its name", () => {
    const listing = appendPage(
      null,
      page([
        { workspaceId: "ws_a", name: "設計チーム" },
        { workspaceId: "ws_b", name: "広報チーム" },
      ]),
      "workspace",
      "ws_a",
    );

    expect(listing.currentLabel).toBe("設計チーム");
    expect(listing.targets).toEqual([
      { ownerType: "user", workspaceId: null, label: PERSONAL_LABEL },
      { ownerType: "workspace", workspaceId: "ws_b", label: "広報チーム" },
    ]);
  });

  it("appends the second page instead of replacing the first", () => {
    const first = appendPage(
      null,
      page([{ workspaceId: "ws_b", name: "広報チーム" }], "cursor_1"),
      "workspace",
      "ws_a",
    );
    const second = appendPage(
      first,
      page([{ workspaceId: "ws_c", name: "経理チーム" }]),
      "workspace",
      "ws_a",
    );

    expect(second.targets.map((target) => target.label)).toEqual([
      PERSONAL_LABEL,
      "広報チーム",
      "経理チーム",
    ]);
    expect(second.nextCursor).toBeNull();
  });

  it("keeps the label the current workspace dropped on an earlier page", () => {
    const first = appendPage(
      null,
      page([{ workspaceId: "ws_a", name: "設計チーム" }], "cursor_1"),
      "workspace",
      "ws_a",
    );
    const second = appendPage(
      first,
      page([{ workspaceId: "ws_c", name: "経理チーム" }]),
      "workspace",
      "ws_a",
    );

    expect(second.currentLabel).toBe("設計チーム");
  });

  it("does not offer the personal row when the note is already personal", () => {
    const listing = appendPage(
      null,
      page([{ workspaceId: "ws_a", name: "設計チーム" }]),
      "user",
      "user_1",
    );

    expect(listing.currentLabel).toBeNull();
    expect(listing.targets).toEqual([
      { ownerType: "workspace", workspaceId: "ws_a", label: "設計チーム" },
    ]);
  });

  it("clears the pending flag and the error the failed page left behind", () => {
    const failedOnce: Loaded = {
      ...appendPage(
        null,
        page([{ workspaceId: "ws_b", name: "広報チーム" }], "cursor_1"),
        "workspace",
        "ws_a",
      ),
      pending: true,
      error: "読み込みに失敗しました",
    };

    const retried = appendPage(
      failedOnce,
      page([{ workspaceId: "ws_c", name: "経理チーム" }]),
      "workspace",
      "ws_a",
    );

    expect(retried.pending).toBe(false);
    expect(retried.error).toBeNull();
  });
});
