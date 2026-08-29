import { isBusinessRuleError } from "@repo/core/domain/error";
import { describe, expect, it } from "vitest";
import { WorkspaceErrorCode } from "../errorCode";
import {
  InvitationId,
  MembershipId,
  WorkspaceDescription,
  WorkspaceId,
  WorkspaceName,
  WorkspaceRole,
  WorkspaceSlug,
} from "../valueObject";

/**
 * DOM-workspace-001〜007 (spec/domains/workspace.md#値オブジェクト).
 */

const codeOf = (fn: () => unknown): string | null => {
  try {
    fn();
    return null;
  } catch (error) {
    return isBusinessRuleError(error) ? error.code : null;
  }
};

describe("WorkspaceId / MembershipId / InvitationId", () => {
  it("rejects an empty or whitespace-only id with InvalidId", () => {
    for (const create of [
      WorkspaceId.create,
      MembershipId.create,
      InvitationId.create,
    ]) {
      expect(codeOf(() => create(""))).toBe(WorkspaceErrorCode.InvalidId);
      expect(codeOf(() => create("   \t\n"))).toBe(
        WorkspaceErrorCode.InvalidId,
      );
    }
  });

  it("trims surrounding whitespace off an otherwise valid id", () => {
    expect(WorkspaceId.create("  ws-1  ")).toBe("ws-1");
    expect(MembershipId.create("\tm-1\n")).toBe("m-1");
    expect(InvitationId.create(" i-1 ")).toBe("i-1");
  });
});

describe("WorkspaceSlug", () => {
  it("accepts the 3-character minimum and the 30-character maximum", () => {
    expect(WorkspaceSlug.create("abc")).toBe("abc");
    const longest = `a${"b".repeat(28)}c`;
    expect(longest).toHaveLength(30);
    expect(WorkspaceSlug.create(longest)).toBe(longest);
  });

  it("rejects 2 characters and 31 characters with InvalidSlug", () => {
    expect(codeOf(() => WorkspaceSlug.create("ab"))).toBe(
      WorkspaceErrorCode.InvalidSlug,
    );
    expect(codeOf(() => WorkspaceSlug.create(`a${"b".repeat(29)}c`))).toBe(
      WorkspaceErrorCode.InvalidSlug,
    );
  });

  it("allows `-` and `_` inside but not at either end", () => {
    expect(WorkspaceSlug.create("team_alpha-1")).toBe("team_alpha-1");
    expect(codeOf(() => WorkspaceSlug.create("-team"))).toBe(
      WorkspaceErrorCode.InvalidSlug,
    );
    expect(codeOf(() => WorkspaceSlug.create("team-"))).toBe(
      WorkspaceErrorCode.InvalidSlug,
    );
    expect(codeOf(() => WorkspaceSlug.create("_team"))).toBe(
      WorkspaceErrorCode.InvalidSlug,
    );
    expect(codeOf(() => WorkspaceSlug.create("team_"))).toBe(
      WorkspaceErrorCode.InvalidSlug,
    );
  });

  it("rejects characters outside [a-z0-9_-]", () => {
    expect(codeOf(() => WorkspaceSlug.create("team alpha"))).toBe(
      WorkspaceErrorCode.InvalidSlug,
    );
    expect(codeOf(() => WorkspaceSlug.create("team.alpha"))).toBe(
      WorkspaceErrorCode.InvalidSlug,
    );
    expect(codeOf(() => WorkspaceSlug.create("チーム"))).toBe(
      WorkspaceErrorCode.InvalidSlug,
    );
  });

  it("compares in lowercase, so an upper-case spelling normalizes", () => {
    expect(WorkspaceSlug.create("Team-Alpha")).toBe("team-alpha");
    expect(WorkspaceSlug.create("  TEAM  ")).toBe("team");
  });

  it("refuses every reserved slug with SlugReserved", () => {
    for (const reserved of ["new", "settings", "api", "search", "about"]) {
      expect(codeOf(() => WorkspaceSlug.create(reserved))).toBe(
        WorkspaceErrorCode.SlugReserved,
      );
    }
  });

  it("normalizes before judging reserved, so `New` is reserved too", () => {
    expect(codeOf(() => WorkspaceSlug.create("New"))).toBe(
      WorkspaceErrorCode.SlugReserved,
    );
  });

  it("leaves a word that merely contains a reserved one alone", () => {
    expect(WorkspaceSlug.create("news")).toBe("news");
    expect(WorkspaceSlug.create("api-docs")).toBe("api-docs");
  });
});

describe("WorkspaceName", () => {
  it("trims and accepts 1 to 80 characters", () => {
    expect(WorkspaceName.create("  Team  ")).toBe("Team");
    expect(WorkspaceName.create("あ")).toBe("あ");
    const longest = "あ".repeat(80);
    expect(WorkspaceName.create(longest)).toBe(longest);
  });

  it("rejects an empty or whitespace-only name with InvalidName", () => {
    expect(codeOf(() => WorkspaceName.create(""))).toBe(
      WorkspaceErrorCode.InvalidName,
    );
    expect(codeOf(() => WorkspaceName.create("   "))).toBe(
      WorkspaceErrorCode.InvalidName,
    );
  });

  it("rejects 81 characters with InvalidName", () => {
    expect(codeOf(() => WorkspaceName.create("あ".repeat(81)))).toBe(
      WorkspaceErrorCode.InvalidName,
    );
  });

  it("counts the trimmed length, so padding does not push a name over", () => {
    const padded = `  ${"あ".repeat(80)}  `;
    expect(WorkspaceName.create(padded)).toBe("あ".repeat(80));
  });
});

describe("WorkspaceDescription", () => {
  it("allows an empty description and keeps it verbatim", () => {
    expect(WorkspaceDescription.create("")).toBe("");
    expect(WorkspaceDescription.create("  spaced  ")).toBe("  spaced  ");
  });

  it("accepts 500 characters and rejects 501 with InvalidDescription", () => {
    const longest = "あ".repeat(500);
    expect(WorkspaceDescription.create(longest)).toBe(longest);
    expect(codeOf(() => WorkspaceDescription.create("あ".repeat(501)))).toBe(
      WorkspaceErrorCode.InvalidDescription,
    );
  });
});

describe("WorkspaceRole", () => {
  it("accepts the three known roles and rejects anything else", () => {
    expect(WorkspaceRole.create("owner")).toBe("owner");
    expect(WorkspaceRole.create("editor")).toBe("editor");
    expect(WorkspaceRole.create("viewer")).toBe("viewer");
    expect(codeOf(() => WorkspaceRole.create("admin"))).toBe(
      WorkspaceErrorCode.InvalidRole,
    );
    expect(codeOf(() => WorkspaceRole.create("Owner"))).toBe(
      WorkspaceErrorCode.InvalidRole,
    );
    expect(codeOf(() => WorkspaceRole.create(""))).toBe(
      WorkspaceErrorCode.InvalidRole,
    );
  });

  it("orders owner > editor > viewer through atLeast", () => {
    const expected: Readonly<Record<string, boolean>> = {
      "owner>=owner": true,
      "owner>=editor": true,
      "owner>=viewer": true,
      "editor>=owner": false,
      "editor>=editor": true,
      "editor>=viewer": true,
      "viewer>=owner": false,
      "viewer>=editor": false,
      "viewer>=viewer": true,
    };
    const roles = ["owner", "editor", "viewer"] as const;
    const actual: Record<string, boolean> = {};
    for (const role of roles) {
      for (const minimum of roles) {
        actual[`${role}>=${minimum}`] = WorkspaceRole.atLeast(role, minimum);
      }
    }
    expect(actual).toEqual(expected);
  });
});
