import { BusinessRuleError } from "@repo/core/domain/error";
import type { UserId } from "@repo/core/domain/identity/valueObject";
import type { NoteOwner } from "@repo/core/domain/note/valueObject";
import type { WorkspaceId } from "@repo/core/domain/workspace/valueObject";
import { TagErrorCode } from "./errorCode";

declare const tagIdBrand: unique symbol;
declare const assignmentIdBrand: unique symbol;

export type TagId = string & { readonly [tagIdBrand]: true };

export const TagId = {
  create: (id: string): TagId => {
    const trimmed = id.trim();
    if (trimmed.length === 0) {
      throw new BusinessRuleError(TagErrorCode.InvalidId, "Invalid tag id");
    }
    return trimmed as TagId;
  },
};

export type AssignmentId = string & { readonly [assignmentIdBrand]: true };

export const AssignmentId = {
  create: (id: string): AssignmentId => {
    const trimmed = id.trim();
    if (trimmed.length === 0) {
      throw new BusinessRuleError(
        TagErrorCode.InvalidId,
        "Invalid tag assignment id",
      );
    }
    return trimmed as AssignmentId;
  },
};

/**
 * Namespace a tag belongs to. A tag never moves between scopes, so this
 * is fixed at creation and mirrors `NoteOwner` in shape — which is what
 * lets `fromNoteOwner` derive an assignment's scope from the note it is
 * put on (spec/domains/tag.md).
 */
export type TagScope =
  | Readonly<{ type: "user"; userId: UserId }>
  | Readonly<{ type: "workspace"; workspaceId: WorkspaceId }>;

export const TagScope = {
  user: (userId: UserId): TagScope => ({ type: "user", userId }),
  workspace: (workspaceId: WorkspaceId): TagScope => ({
    type: "workspace",
    workspaceId,
  }),
  fromNoteOwner: (owner: NoteOwner): TagScope =>
    owner.type === "user"
      ? TagScope.user(owner.userId)
      : TagScope.workspace(owner.workspaceId),
  equals: (a: TagScope, b: TagScope): boolean =>
    a.type === "user"
      ? b.type === "user" && a.userId === b.userId
      : b.type === "workspace" && a.workspaceId === b.workspaceId,
};
