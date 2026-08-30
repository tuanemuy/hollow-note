import { describe, expect, it } from "vitest";
import {
  namesWorkspace,
  PERSONAL_SCOPE,
  parseScope,
  serializeScope,
  WORKSPACE_ID_MAX_LENGTH,
  workspaceUnavailability,
  workspaceUnavailableDestination,
} from "../scope";

describe("serializeScope / parseScope", () => {
  it("round-trips a workspace selection", () => {
    const scope = { kind: "workspace", workspaceId: "ws_01H" } as const;
    expect(parseScope(serializeScope(scope))).toEqual(scope);
  });

  it("round-trips the personal selection", () => {
    expect(parseScope(serializeScope(PERSONAL_SCOPE))).toEqual(PERSONAL_SCOPE);
  });

  it("falls back to personal for anything unreadable", () => {
    expect(parseScope(null)).toEqual(PERSONAL_SCOPE);
    expect(parseScope(undefined)).toEqual(PERSONAL_SCOPE);
    expect(parseScope("")).toEqual(PERSONAL_SCOPE);
    expect(parseScope("workspace:")).toEqual(PERSONAL_SCOPE);
    expect(parseScope("ws_01H")).toEqual(PERSONAL_SCOPE);
  });

  it("rejects ids that could not have come from the id generator", () => {
    expect(parseScope("workspace:../notes")).toEqual(PERSONAL_SCOPE);
    expect(parseScope("workspace:a b")).toEqual(PERSONAL_SCOPE);
    expect(
      parseScope(`workspace:${"a".repeat(WORKSPACE_ID_MAX_LENGTH + 1)}`),
    ).toEqual(PERSONAL_SCOPE);
  });
});

describe("namesWorkspace", () => {
  it("names the workspace the selection points at", () => {
    expect(
      namesWorkspace({ kind: "workspace", workspaceId: "ws_a" }, "ws_a"),
    ).toBe(true);
  });

  it("keeps a selection that points at another workspace", () => {
    expect(
      namesWorkspace({ kind: "workspace", workspaceId: "ws_a" }, "ws_b"),
    ).toBe(false);
  });

  it("keeps the personal selection whatever workspace is being left", () => {
    expect(namesWorkspace(PERSONAL_SCOPE, "ws_a")).toBe(false);
  });
});

describe("workspaceUnavailability", () => {
  it("separates a workspace whose row is gone from one the viewer cannot open", () => {
    expect(workspaceUnavailability({ kind: "notFound" })).toBe("gone");
    expect(workspaceUnavailability({ kind: "forbidden" })).toBe("denied");
    expect(workspaceUnavailability({ kind: "business" })).toBe("denied");
  });

  it("leaves failures that say nothing about the context alone", () => {
    expect(workspaceUnavailability({ kind: "system" })).toBeNull();
    expect(workspaceUnavailability({ kind: "unknown" })).toBeNull();
    expect(workspaceUnavailability({ kind: "conflict" })).toBeNull();
    expect(workspaceUnavailability({ kind: "validation" })).toBeNull();
    expect(workspaceUnavailability({ kind: "unauthorized" })).toBeNull();
  });
});

/**
 * P-34 の「完了」（spec/pages/index.md#P-34、AC-12）に到達できるのは、
 * 行が消えた設定シェルが子ルートを描いたときだけである。
 */
describe("workspaceUnavailableDestination", () => {
  it("hands a workspace whose row is gone to the child fragment", () => {
    expect(workspaceUnavailableDestination("gone")).toBe("children");
  });

  it("keeps a viewer who is not a member out of the child fragment", () => {
    expect(workspaceUnavailableDestination("denied")).toBe("terminal");
  });

  it("does not open the child fragment when nothing said the context is closed", () => {
    expect(workspaceUnavailableDestination(null)).toBe("terminal");
  });

  it("routes the deletion outcome the read reports, end to end", () => {
    // 削除が完了した直後の `getWorkspaceSettings` は `WORKSPACE_NOT_FOUND`
    // （`notFound`）で落ちる。その 1 本の写像が `children` まで繋がって
    // いなければ、P-34 の完了は誰にも描けない。
    expect(
      workspaceUnavailableDestination(
        workspaceUnavailability({ kind: "notFound" }),
      ),
    ).toBe("children");
    expect(
      workspaceUnavailableDestination(
        workspaceUnavailability({ kind: "business" }),
      ),
    ).toBe("terminal");
  });
});
