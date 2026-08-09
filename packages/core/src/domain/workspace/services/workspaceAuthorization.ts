import type { WorkspaceRole } from "../valueObject";

export type WorkspaceAction =
  | "viewNote"
  | "downloadNote"
  | "createNote"
  | "editNote"
  | "deleteNote"
  | "changeNoteVisibility"
  | "moveNote"
  | "manageTags"
  | "viewTrash"
  | "manageMembers"
  | "manageWorkspace"
  | "publishWorkspace"
  | "deleteWorkspace";

/**
 * Interface-only contract for the Workspace authorization domain service
 * (spec/domains/workspace.md#WorkspaceAuthorization). The implementation —
 * the single action → minimum-role table — ships with the Workspace slice
 * (#3); this slice only injects the type into `NoteAccessPolicy`, whose
 * calls all take the personal-ownership path.
 *
 * Outward entry points are `can` / `ensureCan` only; usecases never call
 * `minimumRoleFor` directly.
 */
export interface WorkspaceAuthorization {
  /** Single source of truth for the action → minimum-role table. */
  minimumRoleFor(action: WorkspaceAction): WorkspaceRole;
  can(role: WorkspaceRole, action: WorkspaceAction): boolean;
  /**
   * Throws `BusinessRuleError(WorkspaceErrorCode.InsufficientRole)` when
   * `can` is false.
   */
  ensureCan(role: WorkspaceRole, action: WorkspaceAction): void;
}
