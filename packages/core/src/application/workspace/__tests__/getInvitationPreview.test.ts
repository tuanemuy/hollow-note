import { describe, expect, it } from "vitest";
import { getInvitationPreview } from "../getInvitationPreview";
import type { InvitationPreviewView } from "../view";
import {
  createWorkspaceHarness,
  expectNotFound,
  markUserDeleted,
  removeWorkspaceRow,
  seedInvitation,
  seedWorkspace,
  type TestHarness,
  workspaceScope,
} from "./harness";

/**
 * spec/testcases/workspace/getInvitationPreview.md (TC-workspace-117〜124).
 *
 * TC-workspace-123 (signed out, `workspaceId: null`) is covered by
 * `invitationResponse.test.ts`, which pins the exposure rule for both the
 * signed-out and the member branch; only the branch **precedence** of
 * TC-workspace-122 is re-examined here.
 */

const WORKSPACE = "workspace-1";
const OWNER = "owner-1";
const MEMBER = "member-1";
const INVITATION = "invitation-1";
const INVITEE = "invitee@example.com";

const NOT_FOUND = "INVITATION_NOT_FOUND";

const open = (
  h: TestHarness,
  token: string,
  userId: string | null = null,
): Promise<InvitationPreviewView> =>
  getInvitationPreview({ container: h.container, input: { token, userId } });

const seedTeam = (h: TestHarness, members: readonly string[] = []) =>
  seedWorkspace(h, {
    workspaceId: WORKSPACE,
    name: "Team Alpha",
    description: "Where the work happens",
    members: [
      { userId: OWNER, role: "owner", displayName: "Owner One" },
      ...members.map((userId) => ({ userId, role: "editor" as const })),
    ],
  });

describe("getInvitationPreview", () => {
  it("TC-workspace-117: a live invitation shows the workspace, the role and the inviter", async () => {
    const h = createWorkspaceHarness();
    await seedTeam(h);
    const seeded = await seedInvitation(h, WORKSPACE, {
      invitedBy: OWNER,
      email: INVITEE,
      role: "viewer",
    });

    await expect(open(h, seeded.token)).resolves.toEqual({
      workspaceId: null,
      workspaceName: "Team Alpha",
      workspaceDescription: "Where the work happens",
      role: "viewer",
      inviterName: "Owner One",
      email: INVITEE,
      state: "acceptable",
    });
  });

  it("TC-workspace-117: an inviter whose account is gone leaves the preview renderable", async () => {
    const h = createWorkspaceHarness();
    await seedTeam(h);
    const seeded = await seedInvitation(h, WORKSPACE, { invitedBy: OWNER });
    markUserDeleted(h, OWNER);

    await expect(open(h, seeded.token)).resolves.toMatchObject({
      inviterName: null,
      state: "acceptable",
    });
  });

  it("TC-workspace-118: a lapsed invitation reads expired, not not-found", async () => {
    const h = createWorkspaceHarness();
    await seedTeam(h);
    const seeded = await seedInvitation(h, WORKSPACE, {
      invitedBy: OWNER,
      state: "expired",
    });

    await expect(open(h, seeded.token)).resolves.toMatchObject({
      state: "expired",
      workspaceName: "Team Alpha",
    });
  });

  it("TC-workspace-118: expiry is decided against the clock, not the route", async () => {
    const h = createWorkspaceHarness();
    await seedTeam(h);
    const seeded = await seedInvitation(h, WORKSPACE, { invitedBy: OWNER });
    const expiresAt = seeded.invitation.expiresAt.getTime();

    h.clock.set(new Date(expiresAt - 1));
    await expect(open(h, seeded.token)).resolves.toMatchObject({
      state: "acceptable",
    });

    // `expiresAt` itself is already past the window (`<=` in the domain).
    h.clock.set(new Date(expiresAt));
    await expect(open(h, seeded.token)).resolves.toMatchObject({
      state: "expired",
    });
  });

  it("TC-workspace-119: a revoked invitation whose route is still open reads revoked", async () => {
    const h = createWorkspaceHarness();
    await seedTeam(h);
    const seeded = await seedInvitation(h, WORKSPACE, {
      invitedBy: OWNER,
      state: "revoked",
      route: "active",
    });

    await expect(open(h, seeded.token)).resolves.toMatchObject({
      state: "revoked",
      workspaceId: null,
    });
  });

  it("TC-workspace-120: an accepted invitation whose route is still open reads accepted", async () => {
    const h = createWorkspaceHarness();
    await seedTeam(h);
    const seeded = await seedInvitation(h, WORKSPACE, {
      invitedBy: OWNER,
      state: "accepted",
      acceptedBy: MEMBER,
      route: "active",
    });

    await expect(open(h, seeded.token)).resolves.toMatchObject({
      state: "accepted",
      workspaceId: null,
    });
  });

  it("TC-workspace-121: a workspace the deletion saga removed reads workspaceMissing", async () => {
    const h = createWorkspaceHarness();
    await seedTeam(h);
    const seeded = await seedInvitation(h, WORKSPACE, { invitedBy: OWNER });
    removeWorkspaceRow(h, WORKSPACE);

    await expect(open(h, seeded.token)).resolves.toMatchObject({
      state: "workspaceMissing",
      workspaceName: "",
      workspaceDescription: "",
      workspaceId: null,
    });
  });

  it("TC-workspace-122: alreadyMember outranks the invitation's own terminal status", async () => {
    const h = createWorkspaceHarness();
    await seedTeam(h, [MEMBER]);
    const consumed = await seedInvitation(h, WORKSPACE, {
      invitedBy: OWNER,
      state: "accepted",
      acceptedBy: MEMBER,
      route: "active",
    });
    const lapsed = await seedInvitation(h, WORKSPACE, {
      invitationId: "invitation-2",
      email: "other@example.com",
      invitedBy: OWNER,
      state: "expired",
    });

    // A member re-opening the link they already used is sent to the
    // workspace rather than told the invitation went stale.
    await expect(open(h, consumed.token, MEMBER)).resolves.toMatchObject({
      state: "alreadyMember",
      workspaceId: WORKSPACE,
    });
    await expect(open(h, lapsed.token, MEMBER)).resolves.toMatchObject({
      state: "alreadyMember",
      workspaceId: WORKSPACE,
    });
  });

  it("TC-workspace-122: workspaceMissing outranks alreadyMember", async () => {
    const h = createWorkspaceHarness();
    await seedTeam(h, [MEMBER]);
    const seeded = await seedInvitation(h, WORKSPACE, { invitedBy: OWNER });
    removeWorkspaceRow(h, WORKSPACE);

    await expect(open(h, seeded.token, MEMBER)).resolves.toMatchObject({
      state: "workspaceMissing",
      workspaceId: null,
    });
  });

  it("TC-workspace-124: a token that never opened, one still reserved, and one already closed all read not-found", async () => {
    const h = createWorkspaceHarness();
    await seedTeam(h);
    const inFlight = await seedInvitation(h, WORKSPACE, {
      invitationId: "invitation-reserved",
      email: "reserved@example.com",
      invitedBy: OWNER,
      route: "reserved",
    });
    const closed = await seedInvitation(h, WORKSPACE, {
      invitationId: "invitation-closed",
      email: "closed@example.com",
      invitedBy: OWNER,
      state: "revoked",
    });

    await expectNotFound(open(h, "never-issued-token"), NOT_FOUND);
    await expectNotFound(open(h, inFlight.token), NOT_FOUND);
    await expectNotFound(open(h, closed.token), NOT_FOUND);
  });

  it("TC-workspace-124: an active route whose invitation row is gone reads not-found", async () => {
    const h = createWorkspaceHarness();
    await seedTeam(h);
    const seeded = await seedInvitation(h, WORKSPACE, { invitedBy: OWNER });
    // The route outlived the invitation the scope purge removed — a state
    // no usecase produces, written straight to the scope store.
    h.backend.scope(workspaceScope(WORKSPACE)).invitations.delete(INVITATION);

    await expectNotFound(open(h, seeded.token), NOT_FOUND);
  });
});
