import { BusinessRuleError } from "@repo/core/domain/error";
import { NoteErrorCode } from "../errorCode";
import type { Note } from "../note";
import type { NoteOwner } from "../valueObject";
import type { NoteAccess } from "./noteAccessPolicy";

export type TargetOwnerAccess = Readonly<{
  owner: NoteOwner;
  canCreate: boolean;
}>;

/** Decides whether a note may move to another owner. */
export const NoteOwnershipPolicy = {
  ensureMovable: (
    note: Note,
    from: NoteAccess,
    to: TargetOwnerAccess,
  ): void => {
    if (from.kind !== "granted" || !from.canEdit || !to.canCreate) {
      throw new BusinessRuleError(
        NoteErrorCode.AccessDenied,
        "The viewer cannot move this note",
      );
    }
    if (note.content.status === "processing") {
      throw new BusinessRuleError(
        NoteErrorCode.CannotMoveWhileProcessing,
        "A note cannot move while its body is processing",
      );
    }
  },
};
