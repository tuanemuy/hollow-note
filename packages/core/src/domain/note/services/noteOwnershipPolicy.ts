import { BusinessRuleError } from "@repo/core/domain/error";
import { NoteErrorCode } from "../errorCode";
import type { Note } from "../note";
import type { NoteAccess } from "./noteAccessPolicy";

/**
 * Decides whether a note may leave its current owner.
 *
 * The destination is deliberately not an argument. Whether the actor may
 * create in the target is a workspace-role question this domain cannot
 * evaluate, and the caller must have answered it to name a target at all
 * (`WorkspaceAuthorization.ensureCan(role, "createNote")`, whose refusal
 * is `InsufficientRole` — spec/usecases/note.md#movenote). Taking a
 * `canCreate` flag here only let a caller assert that answer, which is an
 * unenforceable convention rather than a check.
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
