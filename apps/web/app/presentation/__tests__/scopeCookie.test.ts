import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from "@repo/core/application/errors";
import { BusinessRuleError } from "@repo/core/domain/error";
import { beforeEach, describe, expect, it, vi } from "vitest";

// `vi.hoisted` にするのは、モック工場が `../scopeCookie` の import 時点
// （このファイルの本体より前）に呼ばれるため。
const jar = vi.hoisted(() => new Map<string, string>());

vi.mock("@tanstack/react-start/server", () => ({
  getCookie: (name: string) => jar.get(name),
  setCookie: (name: string, value: string) => {
    jar.set(name, value);
  },
  deleteCookie: (name: string) => {
    jar.delete(name);
  },
}));

const { foldScopeSelectionForUnavailable, readScopeSelection } = await import(
  "../scopeCookie"
);

const SCOPE_COOKIE_NAME = "hollow_scope";

const selecting = (workspaceId: string) => {
  jar.set(SCOPE_COOKIE_NAME, `workspace:${workspaceId}`);
};

beforeEach(() => {
  jar.clear();
});

/**
 * 引き継ぎが指す文脈が開けないと分かった時点で畳む（レビュー 007 B-001）。
 * どのケースも**閲覧者自身は何も操作していない** — 他の owner による除名
 * （WS-05）・削除（WS-10）の後で入口から送り込まれた読み出しである。
 */
describe("foldScopeSelectionForUnavailable", () => {
  it("folds the handover after another owner removed the viewer", () => {
    selecting("ws_a");
    expect(
      foldScopeSelectionForUnavailable(
        "ws_a",
        new BusinessRuleError(
          "WORKSPACE_INSUFFICIENT_ROLE",
          "not a member anymore",
        ),
      ),
    ).toBe("denied");
    expect(readScopeSelection()).toEqual({ kind: "personal" });
  });

  it("folds the handover after another owner deleted the workspace", () => {
    selecting("ws_a");
    expect(
      foldScopeSelectionForUnavailable(
        "ws_a",
        new NotFoundError("WORKSPACE_NOT_FOUND", "gone"),
      ),
    ).toBe("gone");
    expect(readScopeSelection()).toEqual({ kind: "personal" });
  });

  it("folds the handover when the read is forbidden", () => {
    selecting("ws_a");
    expect(
      foldScopeSelectionForUnavailable(
        "ws_a",
        new ForbiddenError("FORBIDDEN", "denied"),
      ),
    ).toBe("denied");
    expect(readScopeSelection()).toEqual({ kind: "personal" });
  });

  it("keeps a handover that names another workspace", () => {
    selecting("ws_a");
    expect(
      foldScopeSelectionForUnavailable(
        "ws_b",
        new NotFoundError("WORKSPACE_NOT_FOUND", "gone"),
      ),
    ).toBe("gone");
    expect(readScopeSelection()).toEqual({
      kind: "workspace",
      workspaceId: "ws_a",
    });
  });

  it("keeps the handover when the failure does not close the context", () => {
    selecting("ws_a");
    expect(
      foldScopeSelectionForUnavailable(
        "ws_a",
        new ConflictError("VERSION_CONFLICT", "retry"),
      ),
    ).toBeNull();
    expect(readScopeSelection()).toEqual({
      kind: "workspace",
      workspaceId: "ws_a",
    });
  });
});
