import { describe, expect, it } from "vitest";
import {
  PERSONAL_SCOPE,
  parseScope,
  serializeScope,
  WORKSPACE_ID_MAX_LENGTH,
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
