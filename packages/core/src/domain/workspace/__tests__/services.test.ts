import { isBusinessRuleError } from "@repo/core/domain/error";
import { UserId } from "@repo/core/domain/identity/valueObject";
import { describe, expect, it } from "vitest";
import { WorkspaceErrorCode } from "../errorCode";
import { Membership } from "../membership";
import { MembershipPolicy } from "../services/membershipPolicy";
import {
  type WorkspaceAction,
  WorkspaceAuthorization,
} from "../services/workspaceAuthorization";
import { WorkspaceId, type WorkspaceRole } from "../valueObject";

const T0 = new Date("2026-01-01T00:00:00.000Z");
const WORKSPACE = WorkspaceId.create("ws-1");
const ACTOR = UserId.create("owner-1");
const TARGET = UserId.create("member-1");

const ROLES: readonly WorkspaceRole[] = ["owner", "editor", "viewer"];

const codeOf = (fn: () => unknown): string | null => {
  try {
    fn();
    return null;
  } catch (error) {
    return isBusinessRuleError(error) ? error.code : null;
  }
};

const membership = (userId: UserId, role: WorkspaceRole) =>
  Membership.create({ id: "m-1", workspaceId: WORKSPACE, userId, role }, T0)
    .entity;

describe("WorkspaceAuthorization", () => {
  /** The whole action → minimum-role table. */
  const MINIMUM: Readonly<Record<WorkspaceAction, WorkspaceRole>> = {
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

  const actions = Object.keys(MINIMUM) as readonly WorkspaceAction[];

  it("answers minimumRoleFor from the single spec table", () => {
    const actual = Object.fromEntries(
      actions.map((action) => [
        action,
        WorkspaceAuthorization.minimumRoleFor(action),
      ]),
    );
    expect(actual).toEqual(MINIMUM);
  });

  it("decides `can` for every role × action pair by that table alone", () => {
    const rank: Readonly<Record<WorkspaceRole, number>> = {
      owner: 3,
      editor: 2,
      viewer: 1,
    };
    for (const role of ROLES) {
      for (const action of actions) {
        expect({
          role,
          action,
          can: WorkspaceAuthorization.can(role, action),
        }).toEqual({
          role,
          action,
          can: rank[role] >= rank[MINIMUM[action]],
        });
      }
    }
  });

  it("throws InsufficientRole exactly where `can` is false", () => {
    for (const role of ROLES) {
      for (const action of actions) {
        const thrown = codeOf(() =>
          WorkspaceAuthorization.ensureCan(role, action),
        );
        expect({ role, action, thrown }).toEqual({
          role,
          action,
          thrown: WorkspaceAuthorization.can(role, action)
            ? null
            : WorkspaceErrorCode.InsufficientRole,
        });
      }
    }
  });

  it("keeps backup and PDF download on the actions they share a decision with", () => {
    // No `backupNote` / `downloadPdf` action exists — the decision is
    // `editNote` / `downloadNote`.
    expect(actions).not.toContain("backupNote");
    expect(actions).toHaveLength(13);
  });
});

describe("MembershipPolicy.ensureOwnerRemains", () => {
  it("refuses to demote the last owner", () => {
    expect(
      codeOf(() =>
        MembershipPolicy.ensureOwnerRemains(
          1,
          membership(TARGET, "owner"),
          "editor",
        ),
      ),
    ).toBe(WorkspaceErrorCode.LastOwnerCannotLeave);
  });

  it("refuses to remove the last owner (nextRole null)", () => {
    expect(
      codeOf(() =>
        MembershipPolicy.ensureOwnerRemains(
          1,
          membership(TARGET, "owner"),
          null,
        ),
      ),
    ).toBe(WorkspaceErrorCode.LastOwnerCannotLeave);
  });

  it("allows demoting or removing an owner while a second one remains", () => {
    expect(
      codeOf(() =>
        MembershipPolicy.ensureOwnerRemains(
          2,
          membership(TARGET, "owner"),
          "viewer",
        ),
      ),
    ).toBeNull();
    expect(
      codeOf(() =>
        MembershipPolicy.ensureOwnerRemains(
          2,
          membership(TARGET, "owner"),
          null,
        ),
      ),
    ).toBeNull();
  });

  it("allows a change that leaves the target an owner, even as the only one", () => {
    expect(
      codeOf(() =>
        MembershipPolicy.ensureOwnerRemains(
          1,
          membership(TARGET, "owner"),
          "owner",
        ),
      ),
    ).toBeNull();
  });

  it("ignores a non-owner target whatever the owner count is", () => {
    for (const role of ["editor", "viewer"] as const) {
      expect(
        codeOf(() =>
          MembershipPolicy.ensureOwnerRemains(
            0,
            membership(TARGET, role),
            null,
          ),
        ),
      ).toBeNull();
    }
  });

  it("refuses when the count is already below one", () => {
    expect(
      codeOf(() =>
        MembershipPolicy.ensureOwnerRemains(
          0,
          membership(TARGET, "owner"),
          null,
        ),
      ),
    ).toBe(WorkspaceErrorCode.LastOwnerCannotLeave);
  });
});

describe("MembershipPolicy self-action guards", () => {
  it("refuses a self role change and allows one on another member", () => {
    expect(
      codeOf(() =>
        MembershipPolicy.ensureNotSelfRoleChange(
          ACTOR,
          membership(ACTOR, "owner"),
        ),
      ),
    ).toBe(WorkspaceErrorCode.CannotChangeOwnRole);
    expect(
      codeOf(() =>
        MembershipPolicy.ensureNotSelfRoleChange(
          ACTOR,
          membership(TARGET, "editor"),
        ),
      ),
    ).toBeNull();
  });

  it("refuses a self removal and allows removing another member", () => {
    expect(
      codeOf(() =>
        MembershipPolicy.ensureNotSelfRemoval(
          ACTOR,
          membership(ACTOR, "owner"),
        ),
      ),
    ).toBe(WorkspaceErrorCode.CannotRemoveSelf);
    expect(
      codeOf(() =>
        MembershipPolicy.ensureNotSelfRemoval(
          ACTOR,
          membership(TARGET, "editor"),
        ),
      ),
    ).toBeNull();
  });
});

describe("MembershipPolicy.ensureWorkspaceQuota", () => {
  it("caps ownership at 20 workspaces", () => {
    expect(MembershipPolicy.maxOwnedWorkspaces).toBe(20);
    expect(codeOf(() => MembershipPolicy.ensureWorkspaceQuota(19))).toBeNull();
    expect(codeOf(() => MembershipPolicy.ensureWorkspaceQuota(20))).toBe(
      WorkspaceErrorCode.WorkspaceQuotaExceeded,
    );
    expect(codeOf(() => MembershipPolicy.ensureWorkspaceQuota(21))).toBe(
      WorkspaceErrorCode.WorkspaceQuotaExceeded,
    );
  });
});
