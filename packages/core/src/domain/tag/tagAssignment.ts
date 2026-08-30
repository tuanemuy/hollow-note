import { RehydrationError } from "@repo/core/domain/error";
import { UserId } from "@repo/core/domain/identity/valueObject";
import { NoteId } from "@repo/core/domain/note/valueObject";
import { WorkspaceId } from "@repo/core/domain/workspace/valueObject";
import { AssignmentId, TagId, type TagScope } from "./valueObject";

/**
 * One tag put on one note. Immutable — re-tagging is a delete plus an
 * insert — so there is no OCC and no `version`.
 *
 * Only the rehydration side is here. The write side (`create` and the
 * `tag.assigned` draft it emits, the 50-per-note policy) belongs to the
 * curation slice; what this slice needs is the row a purged note's
 * assignments are read and deleted through.
 */
export type TagAssignment = Readonly<{
  id: AssignmentId;
  tagId: TagId;
  noteId: NoteId;
  scope: TagScope;
  assignedBy: UserId;
  assignedAt: Date;
}>;

type ReconstructInput = Readonly<{
  id: string;
  tagId: string;
  noteId: string;
  scopeType: string;
  scopeId: string;
  assignedBy: string;
  assignedAt: Date;
}>;

export const TagAssignment = {
  reconstruct: (input: ReconstructInput): TagAssignment => {
    try {
      if (input.scopeType !== "user" && input.scopeType !== "workspace") {
        throw new Error(`Invalid tag scope type: ${input.scopeType}`);
      }
      return {
        id: AssignmentId.create(input.id),
        tagId: TagId.create(input.tagId),
        noteId: NoteId.create(input.noteId),
        scope:
          input.scopeType === "user"
            ? { type: "user", userId: UserId.create(input.scopeId) }
            : {
                type: "workspace",
                workspaceId: WorkspaceId.create(input.scopeId),
              },
        assignedBy: UserId.create(input.assignedBy),
        assignedAt: input.assignedAt,
      };
    } catch (error) {
      throw new RehydrationError(
        `Failed to reconstruct TagAssignment ${input.id}`,
        error,
      );
    }
  },
};
