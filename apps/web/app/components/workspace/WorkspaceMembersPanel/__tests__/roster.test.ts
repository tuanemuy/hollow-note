import type {
  PendingInvitationView,
  WorkspaceMemberView,
  WorkspaceRoleView,
} from "@repo/core/application/workspace/view";
import { describe, expect, it } from "vitest";
import {
  applyRoster,
  canLeave,
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

    it("carries a leave whose own row was never loaded as a delta", () => {
      const after = applyRoster(rosterOf([member("m2", "u2", "editor")], []), {
        kind: "leave",
        membershipId: null,
        role: "owner",
      });

      expect(after.members).toHaveLength(1);
      expect(after.memberDelta).toBe(-1);
      expect(after.ownerDelta).toBe(-1);
      expect(after.left).toBe(true);
    });

    it("drops the viewer's own row when the leave knows it", () => {
      const after = applyRoster(rosterOf([viewerAsOwner], []), {
        kind: "leave",
        membershipId: "m1",
        role: "owner",
      });

      expect(after.members).toEqual([]);
      expect(after.left).toBe(true);
    });
  });

  describe("selfIsLastOwner", () => {
    it("judges against the whole workspace rather than the loaded page", () => {
      // 先頭ページには閲覧者しか載っていないが、ワークスペースには owner が 3 人いる。
      expect(selfIsLastOwner(rosterOf([viewerAsOwner], []), "owner", 3)).toBe(
        false,
      );
    });

    it("closes leaving when the viewer is the only owner of the workspace", () => {
      expect(
        selfIsLastOwner(
          rosterOf([viewerAsOwner, member("m2", "u2", "editor")], []),
          "owner",
          1,
        ),
      ).toBe(true);
    });

    it("subtracts an optimistically removed owner from the server count", () => {
      const after = applyRoster(
        rosterOf([viewerAsOwner, member("m2", "u2", "owner")], []),
        { kind: "removeMember", membershipId: "m2", role: "owner" },
      );

      expect(selfIsLastOwner(after, "owner", 2)).toBe(true);
    });

    it("judges the viewer whose own row is off the loaded page all the same", () => {
      // 51 人目以降に参加した閲覧者。自分の行は先頭ページに無い。
      const roster = rosterOf([member("m2", "u2", "editor")], []);

      expect(selfOf(roster, VIEWER)).toBeNull();
      expect(selfIsLastOwner(roster, "owner", 1)).toBe(true);
      expect(selfIsLastOwner(roster, "editor", 1)).toBe(false);
    });

    it("stops claiming last owner once the viewer has optimistically left", () => {
      const after = applyRoster(rosterOf([viewerAsOwner], []), {
        kind: "leave",
        membershipId: "m1",
        role: "owner",
      });

      expect(selfIsLastOwner(after, "owner", 2)).toBe(false);
    });

    it("stays false for a viewer who is not an owner", () => {
      expect(
        selfIsLastOwner(
          rosterOf([member("m1", VIEWER, "editor")], []),
          "editor",
          1,
        ),
      ).toBe(false);
    });
  });

  describe("canLeave", () => {
    it("offers leaving to a viewer whose own row is off the loaded page", () => {
      // 51 人目以降に参加した閲覧者。可否はページの中身ではなく、サーバー
      // が答えた自分のロールと owner 総数だけで決まる。
      const roster = rosterOf([member("m2", "u2", "owner")], []);

      expect(selfOf(roster, VIEWER)).toBeNull();
      expect(canLeave(roster, "editor", 1)).toBe(true);
      expect(canLeave(roster, "owner", 1)).toBe(false);
    });

    it("closes leaving for the last owner", () => {
      expect(canLeave(rosterOf([viewerAsOwner], []), "owner", 1)).toBe(false);
    });

    it("closes leaving once it has been requested", () => {
      const after = applyRoster(rosterOf([viewerAsOwner], []), {
        kind: "leave",
        membershipId: "m1",
        role: "owner",
      });

      expect(canLeave(after, "owner", 3)).toBe(false);
    });
  });
});
