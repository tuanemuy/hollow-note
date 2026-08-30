import { describe, expect, it } from "vitest";
import { listPendingInvitations } from "../listPendingInvitations";
import type { PendingInvitationListView } from "../view";
import {
  createWorkspaceHarness,
  expectBusinessRule,
  seedInvitation,
  seedWorkspace,
  type TestHarness,
} from "./harness";

/**
 * spec/testcases/workspace/listPendingInvitations.md
 * (TC-workspace-177〜182, TC-workspace-303 / 304).
 */

const WORKSPACE = "workspace-1";
const OWNER = "owner-1";
const INSUFFICIENT_ROLE = "WORKSPACE_INSUFFICIENT_ROLE";

const list = (
  h: TestHarness,
  userId: string = OWNER,
): Promise<PendingInvitationListView> =>
  listPendingInvitations({
    container: h.container,
    input: { workspaceId: WORKSPACE, userId },
  });

const seedTeam = (h: TestHarness, extra: readonly string[] = []) =>
  seedWorkspace(h, {
    workspaceId: WORKSPACE,
    members: [
      { userId: OWNER, role: "owner" },
      ...extra.map((userId) => ({
        userId,
        role: userId.startsWith("editor")
          ? ("editor" as const)
          : ("viewer" as const),
      })),
    ],
  });

describe("listPendingInvitations", () => {
  it("TC-workspace-177: both outstanding invitations are listed with their terms", async () => {
    const h = createWorkspaceHarness();
    await seedTeam(h);
    const first = await seedInvitation(h, WORKSPACE, {
      invitationId: "invitation-1",
      email: "first@example.com",
      role: "editor",
      invitedBy: OWNER,
    });
    h.clock.advance(1000);
    const second = await seedInvitation(h, WORKSPACE, {
      invitationId: "invitation-2",
      email: "second@example.com",
      role: "viewer",
      invitedBy: OWNER,
    });

    const view = await list(h);

    expect(view.count).toBe(2);
    // `listByWorkspace` orders createdAt DESC, id DESC.
    expect(view.invitations).toEqual([
      {
        invitationId: "invitation-2",
        email: "second@example.com",
        role: "viewer",
        invitedBy: OWNER,
        createdAt: second.invitation.createdAt,
        expiresAt: second.invitation.expiresAt,
        expired: false,
      },
      {
        invitationId: "invitation-1",
        email: "first@example.com",
        role: "editor",
        invitedBy: OWNER,
        createdAt: first.invitation.createdAt,
        expiresAt: first.invitation.expiresAt,
        expired: false,
      },
    ]);
  });

  it("TC-workspace-178: accepted and revoked invitations are excluded, and count is the pending total", async () => {
    const h = createWorkspaceHarness();
    await seedTeam(h);
    await seedInvitation(h, WORKSPACE, {
      invitationId: "invitation-pending",
      email: "pending@example.com",
      invitedBy: OWNER,
    });
    await seedInvitation(h, WORKSPACE, {
      invitationId: "invitation-accepted",
      email: "accepted@example.com",
      invitedBy: OWNER,
      state: "accepted",
      acceptedBy: OWNER,
    });
    await seedInvitation(h, WORKSPACE, {
      invitationId: "invitation-revoked",
      email: "revoked@example.com",
      invitedBy: OWNER,
      state: "revoked",
    });

    const view = await list(h);

    expect(view.invitations.map((i) => i.invitationId)).toEqual([
      "invitation-pending",
    ]);
    expect(view.count).toBe(1);
  });

  it("TC-workspace-303: a page's worth of terminal invitations does not hide the pending ones", async () => {
    const h = createWorkspaceHarness();
    await seedTeam(h);
    await seedInvitation(h, WORKSPACE, {
      invitationId: "invitation-pending",
      email: "pending@example.com",
      invitedBy: OWNER,
    });
    // Terminal invitations issued *after* the pending one, so they fill
    // the newest page of a `createdAt DESC` listing.
    for (let n = 0; n < 60; n += 1) {
      h.clock.advance(1000);
      await seedInvitation(h, WORKSPACE, {
        invitationId: `invitation-revoked-${n}`,
        email: `revoked-${n}@example.com`,
        invitedBy: OWNER,
        state: "revoked",
      });
    }

    const view = await list(h);

    expect(view.invitations.map((i) => i.invitationId)).toEqual([
      "invitation-pending",
    ]);
    expect(view.count).toBe(1);
  });

  it("TC-workspace-304: count is the pending total, not the number of rows this page holds", async () => {
    const h = createWorkspaceHarness();
    await seedTeam(h);
    for (let n = 0; n < 3; n += 1) {
      h.clock.advance(1000);
      await seedInvitation(h, WORKSPACE, {
        invitationId: `invitation-${n}`,
        email: `pending-${n}@example.com`,
        invitedBy: OWNER,
      });
    }

    const view = await listPendingInvitations({
      container: h.container,
      input: { workspaceId: WORKSPACE, userId: OWNER, page: 2, limit: 2 },
    });

    expect(view.invitations.map((i) => i.invitationId)).toEqual([
      "invitation-0",
    ]);
    expect(view.count).toBe(3);
  });

  it("TC-workspace-179: a lapsed invitation stays in the list, flagged expired", async () => {
    const h = createWorkspaceHarness();
    await seedTeam(h);
    await seedInvitation(h, WORKSPACE, {
      invitationId: "invitation-live",
      email: "live@example.com",
      invitedBy: OWNER,
    });
    await seedInvitation(h, WORKSPACE, {
      invitationId: "invitation-lapsed",
      email: "lapsed@example.com",
      invitedBy: OWNER,
      state: "expired",
    });

    const view = await list(h);

    expect(
      view.invitations.map((i) => [i.invitationId, i.expired]).sort(),
    ).toEqual([
      ["invitation-lapsed", true],
      ["invitation-live", false],
    ]);
    expect(view.count).toBe(2);
  });

  it("TC-workspace-180: everyone below manageMembers is refused", async () => {
    const h = createWorkspaceHarness();
    await seedTeam(h, ["editor-1", "viewer-1"]);
    await seedInvitation(h, WORKSPACE, { invitedBy: OWNER });

    await expectBusinessRule(list(h, "editor-1"), INSUFFICIENT_ROLE);
    await expectBusinessRule(list(h, "viewer-1"), INSUFFICIENT_ROLE);
    await expectBusinessRule(list(h, "outsider-1"), INSUFFICIENT_ROLE);
  });

  it("TC-workspace-181: an empty roster answers an empty list and count 0", async () => {
    const h = createWorkspaceHarness();
    await seedTeam(h);

    await expect(list(h)).resolves.toEqual({ invitations: [], count: 0 });
  });

  it("TC-workspace-182: the response carries no token in any form", async () => {
    const h = createWorkspaceHarness();
    await seedTeam(h);
    const seeded = await seedInvitation(h, WORKSPACE, { invitedBy: OWNER });

    const view = await list(h);

    const entry = view.invitations[0];
    expect(Object.keys(entry ?? {}).sort()).toEqual([
      "createdAt",
      "email",
      "expired",
      "expiresAt",
      "invitationId",
      "invitedBy",
      "role",
    ]);
    const serialized = JSON.stringify(view);
    expect(serialized).not.toContain(seeded.token);
    expect(serialized).not.toContain(seeded.tokenHash);
  });
});
