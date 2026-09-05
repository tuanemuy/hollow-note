import {
  isBusinessRuleError,
  isRehydrationError,
} from "@repo/core/domain/error";
import { UserId } from "@repo/core/domain/identity/valueObject";
import { NoteId } from "@repo/core/domain/note/valueObject";
import { WorkspaceId } from "@repo/core/domain/workspace/valueObject";
import { describe, expect, it } from "vitest";
import { TagErrorCode } from "../errorCode";
import { TagAssignment } from "../tagAssignment";
import { AssignmentId, TagId, TagScope } from "../valueObject";

const codeOf = (fn: () => unknown): string | null => {
  try {
    fn();
    return null;
  } catch (error) {
    return isBusinessRuleError(error) ? error.code : null;
  }
};

const ASSIGNED_AT = new Date("2026-01-01T00:00:00.000Z");

const input = (overrides: Partial<Record<string, string>> = {}) => ({
  id: "assignment-1",
  tagId: "tag-1",
  noteId: "note-1",
  scopeType: "user",
  scopeId: "user-1",
  assignedBy: "user-1",
  assignedAt: ASSIGNED_AT,
  ...overrides,
});

describe("DOM-tag-001 / DOM-tag-002: TagId and AssignmentId", () => {
  it("trims and refuses an id that is nothing but whitespace", () => {
    expect(TagId.create("  tag-1  ")).toBe("tag-1");
    expect(AssignmentId.create("  assignment-1  ")).toBe("assignment-1");
    expect(codeOf(() => TagId.create("   "))).toBe(TagErrorCode.InvalidId);
    expect(codeOf(() => AssignmentId.create(""))).toBe(TagErrorCode.InvalidId);
  });
});

describe("DOM-tag-004: TagScope", () => {
  it("names the scope object a tag belongs to, by kind", () => {
    expect(TagScope.user(UserId.create("user-1"))).toEqual({
      type: "user",
      userId: "user-1",
    });
    expect(TagScope.workspace(WorkspaceId.create("workspace-1"))).toEqual({
      type: "workspace",
      workspaceId: "workspace-1",
    });
  });
});

describe("DOM-tag-006: TagAssignment.reconstruct", () => {
  it("rehydrates a stored row into the two scope shapes", () => {
    expect(TagAssignment.reconstruct(input()).scope).toEqual({
      type: "user",
      userId: "user-1",
    });
    expect(
      TagAssignment.reconstruct(
        input({ scopeType: "workspace", scopeId: "workspace-1" }),
      ).scope,
    ).toEqual({ type: "workspace", workspaceId: "workspace-1" });
    expect(TagAssignment.reconstruct(input()).noteId).toBe(
      NoteId.create("note-1"),
    );
  });

  it("refuses a scope type no writer can have produced", () => {
    // The column is a stored string, so an unknown value means the row
    // is corrupt — a rehydration fault, not a business-rule violation
    // the caller could have avoided.
    const thrown = ((): unknown => {
      try {
        return TagAssignment.reconstruct(input({ scopeType: "team" }));
      } catch (error) {
        return error;
      }
    })();

    expect(isRehydrationError(thrown)).toBe(true);
  });

  it("refuses a row whose ids did not survive storage", () => {
    for (const field of ["id", "tagId", "noteId", "assignedBy"]) {
      expect(
        isRehydrationError(
          ((): unknown => {
            try {
              return TagAssignment.reconstruct(input({ [field]: "  " }));
            } catch (error) {
              return error;
            }
          })(),
        ),
      ).toBe(true);
    }
  });
});
