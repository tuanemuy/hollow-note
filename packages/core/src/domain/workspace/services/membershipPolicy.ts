import { BusinessRuleError } from "@repo/core/domain/error";
import type { UserId } from "@repo/core/domain/identity/valueObject";
import { WorkspaceErrorCode } from "../errorCode";
import type { Membership } from "../membership";
import type { WorkspaceRole } from "../valueObject";

/**
 * Rules over the member set of a single workspace
 * (spec/domains/workspace.md#MembershipPolicy).
 *
 * The counts arrive as arguments because the policy is pure: the caller
 * reads them inside the same unit of work that applies the change, so the
 * count it judges and the row it writes cannot drift apart.
 */
export const MembershipPolicy = {
  maxOwnedWorkspaces: 20,

  /**
   * `nextRole` is the role the target holds after the change; `null`
   * means removal. A workspace always keeps at least one owner.
   */
  ensureOwnerRemains: (
    ownerCount: number,
    target: Membership,
    nextRole: WorkspaceRole | null,
  ): void => {
    if (target.role !== "owner" || nextRole === "owner") {
      return;
    }
    if (ownerCount <= 1) {
      throw new BusinessRuleError(
        WorkspaceErrorCode.LastOwnerCannotLeave,
        "The last owner cannot leave the workspace",
      );
    }
  },

  ensureNotSelfRoleChange: (actor: UserId, target: Membership): void => {
    if (actor === target.userId) {
      throw new BusinessRuleError(
        WorkspaceErrorCode.CannotChangeOwnRole,
        "A member cannot change their own role",
      );
    }
  },

  /** Leaving on one's own goes through `leaveWorkspace`, not removal. */
  ensureNotSelfRemoval: (actor: UserId, target: Membership): void => {
    if (actor === target.userId) {
      throw new BusinessRuleError(
        WorkspaceErrorCode.CannotRemoveSelf,
        "A member cannot remove themselves",
      );
    }
  },

  ensureWorkspaceQuota: (ownedCount: number): void => {
    if (ownedCount >= MembershipPolicy.maxOwnedWorkspaces) {
      throw new BusinessRuleError(
        WorkspaceErrorCode.WorkspaceQuotaExceeded,
        `A user can own at most ${MembershipPolicy.maxOwnedWorkspaces} workspaces`,
      );
    }
  },
};
