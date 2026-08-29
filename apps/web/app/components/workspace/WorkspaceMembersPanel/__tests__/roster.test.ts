import type {
  PendingInvitationView,
  WorkspaceMemberView,
  WorkspaceRoleView,
} from "@repo/core/application/workspace/view";
import { describe, expect, it } from "vitest";
import {
  applyRoster,
  PENDING_INVITATION_ID,
  rosterOf,
  selfIsLastOwner,
  selfOf,
} from "../roster";

const member = (
  id: string,
  userId: string,
  role: WorkspaceRoleView,
): WorkspaceMemberView => ({
  membershipId: id,
  userId,
  displayName: userId,
  email: `${userId}@example.com`,
  avatarUrl: null,
  role,
  joinedAt: new Date(0),
});

const invitation = (id: string): PendingInvitationView => ({
  invitationId: id,
  email: `${id}@example.com`,
  role: "editor",
  invitedBy: "u1",
  createdAt: new Date(0),
  expiresAt: new Date(0),
  expired: false,
});

const VIEWER = "u1";
const viewerAsOwner = member("m1", VIEWER, "owner");

describe("P-32 roster", () => {
  describe("applyRoster", () => {
    it("carries an optimistic removal as a delta against the server totals", () => {
      const after = applyRoster(rosterOf([viewerAsOwner], []), {
        kind: "removeMember",
        membershipId: "m1",
        role: "owner",
      });

      expect(after.members).toEqual([]);
      expect(after.memberDelta).toBe(-1);
      expect(after.ownerDelta).toBe(-1);
    });

    it("leaves the owner delta alone when the removed member is not an owner", () => {
      const after = applyRoster(
        rosterOf([viewerAsOwner, member("m2", "u2", "editor")], []),
        { kind: "removeMember", membershipId: "m2", role: "editor" },
      );

      expect(after.memberDelta).toBe(-1);
      expect(after.ownerDelta).toBe(0);
    });

    it("moves the invitation delta in both directions", () => {
      const added = applyRoster(rosterOf([], [invitation("i1")]), {
        kind: "addInvitation",
        email: "new@example.com",
        role: "viewer",
      });

      expect(added.invitationDelta).toBe(1);
      expect(added.invitations.at(-1)?.invitationId).toBe(
        PENDING_INVITATION_ID,
      );

      const revoked = applyRoster(added, {
        kind: "revokeInvitation",
        invitationId: "i1",
      });

      expect(revoked.invitationDelta).toBe(0);
      expect(revoked.invitations).toHaveLength(1);
    });
  });

  describe("selfIsLastOwner", () => {
    it("judges against the whole workspace rather than the loaded page", () => {
      // 先頭ページには閲覧者しか載っていないが、ワークスペースには owner が 3 人いる。
      expect(selfIsLastOwner(rosterOf([viewerAsOwner], []), VIEWER, 3)).toBe(
        false,
      );
    });

    it("closes leaving when the viewer is the only owner of the workspace", () => {
      expect(
        selfIsLastOwner(
          rosterOf([viewerAsOwner, member("m2", "u2", "editor")], []),
          VIEWER,
          1,
        ),
      ).toBe(true);
    });

    it("subtracts an optimistically removed owner from the server count", () => {
      const after = applyRoster(
        rosterOf([viewerAsOwner, member("m2", "u2", "owner")], []),
        { kind: "removeMember", membershipId: "m2", role: "owner" },
      );

      expect(selfIsLastOwner(after, VIEWER, 2)).toBe(true);
    });

    it("stays false while the viewer's own row is off the loaded page", () => {
      const roster = rosterOf([member("m2", "u2", "owner")], []);

      expect(selfOf(roster, VIEWER)).toBeNull();
      expect(selfIsLastOwner(roster, VIEWER, 1)).toBe(false);
    });

    it("stays false for a viewer who is not an owner", () => {
      expect(
        selfIsLastOwner(
          rosterOf([member("m1", VIEWER, "editor")], []),
          VIEWER,
          1,
        ),
      ).toBe(false);
    });
  });
});
