import { BusinessRuleError } from "@repo/core/domain/error";
import { WorkspaceErrorCode } from "./errorCode";

declare const workspaceIdBrand: unique symbol;

/**
 * Minimal Workspace vocabulary for the walking-skeleton slice.
 *
 * The full Workspace domain (entities, memberships, invitations) is built
 * in slice #3; these value objects exist now because `ScopeKey`,
 * `AccountDeletionManifestStore`, `NoteOwner`, and `NoteViewer` reference
 * them by type.
 */
export type WorkspaceId = string & { readonly [workspaceIdBrand]: true };

export const WorkspaceId = {
  create: (id: string): WorkspaceId => {
    const trimmed = id.trim();
    if (trimmed.length === 0) {
      throw new BusinessRuleError(
        WorkspaceErrorCode.InvalidId,
        "Invalid workspace id",
      );
    }
    return trimmed as WorkspaceId;
  },
};

export type WorkspaceRole = "owner" | "editor" | "viewer";

const ROLE_RANK: Record<WorkspaceRole, number> = {
  owner: 3,
  editor: 2,
  viewer: 1,
};

export const WorkspaceRole = {
  create: (raw: string): WorkspaceRole => {
    if (raw !== "owner" && raw !== "editor" && raw !== "viewer") {
      throw new BusinessRuleError(
        WorkspaceErrorCode.InvalidRole,
        `Invalid workspace role: ${raw}`,
      );
    }
    return raw;
  },
  /** Role ordering is `owner > editor > viewer`. */
  atLeast: (role: WorkspaceRole, minimum: WorkspaceRole): boolean =>
    ROLE_RANK[role] >= ROLE_RANK[minimum],
};
