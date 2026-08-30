import { BusinessRuleError } from "@repo/core/domain/error";
import { NoteErrorCode } from "../errorCode";
import type { Note } from "../note";
import type { NoteAccess } from "./noteAccessPolicy";

/**
 * Decides whether a note may leave its current owner.
 *
 * The destination is not an argument: whether the actor may create in the
 * target is a workspace-role question this domain cannot evaluate, and the
 * caller has answered it before naming a target
 * (`WorkspaceAuthorization.ensureCan(role, "createNote")`, whose refusal is
 * `InsufficientRole`).
 */
export const NoteOwnershipPolicy = {
  ensureMovable: (note: Note, from: NoteAccess): void => {
    if (from.kind !== "granted" || !from.canEdit) {
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
