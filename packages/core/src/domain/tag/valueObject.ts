import { BusinessRuleError } from "@repo/core/domain/error";
import type { UserId } from "@repo/core/domain/identity/valueObject";
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
 * is fixed at creation and mirrors `NoteOwner` in shape — the scope of
 * an assignment is the scope of the note it is put on
 * (spec/domains/tag.md).
 *
 * Only the two constructors are here. Deriving a scope from a
 * `NoteOwner` and comparing two scopes are tools of the write side, and
 * arrive with the slice that owns tagging itself.
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
};
