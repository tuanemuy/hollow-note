import { BusinessRuleError } from "@repo/core/domain/error";
import { WorkspaceErrorCode } from "../errorCode";
import { WorkspaceRole } from "../valueObject";

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
 * Role-based authorization for workspace actions
 * (spec/domains/workspace.md#WorkspaceAuthorization, ADR 004).
 *
 * Outward entry points are `can` / `ensureCan` only; usecases never call
 * `minimumRoleFor` or `WorkspaceRole.atLeast` directly. The interface is
 * kept so a container can inject the service, and
 * `WorkspaceAuthorization` below is the single implementation.
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

/**
 * Backing up a note deliberately reuses `editNote` instead of getting its
 * own action: a `BackupRecord` is shared state attached to the note, so
 * writing one is the same decision `editNote` already guards. Splitting
 * them would let the two rows drift. Generating a download likewise reuses
 * `downloadNote` (spec/domains/workspace.md#WorkspaceAuthorization).
 */
const MINIMUM_ROLE: Readonly<Record<WorkspaceAction, WorkspaceRole>> = {
  viewNote: "viewer",
  downloadNote: "viewer",
  createNote: "editor",
  editNote: "editor",
  deleteNote: "editor",
  changeNoteVisibility: "editor",
  moveNote: "editor",
  manageTags: "editor",
  viewTrash: "editor",
  manageMembers: "owner",
  manageWorkspace: "owner",
  publishWorkspace: "owner",
  deleteWorkspace: "owner",
};

const minimumRoleFor = (action: WorkspaceAction): WorkspaceRole =>
  MINIMUM_ROLE[action];

const can = (role: WorkspaceRole, action: WorkspaceAction): boolean =>
  WorkspaceRole.atLeast(role, minimumRoleFor(action));

export const WorkspaceAuthorization: WorkspaceAuthorization = {
  minimumRoleFor,
  can,
  ensureCan: (role, action) => {
    if (!can(role, action)) {
      throw new BusinessRuleError(
        WorkspaceErrorCode.InsufficientRole,
        `Role ${role} cannot perform ${action}`,
      );
    }
  },
};
