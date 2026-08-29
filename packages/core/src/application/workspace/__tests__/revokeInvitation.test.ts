import { describe, expect, it } from "vitest";
import type { RequestContainer } from "../../di/types";
import { isValidationError } from "../../errors";
import { acceptInvitation } from "../acceptInvitation";
import { getInvitationPreview } from "../getInvitationPreview";
import { inviteMember } from "../inviteMember";
import { revokeInvitation } from "../revokeInvitation";
import {
  createWorkspaceHarness,
  expectBusinessRule,
  expectNotFound,
  expectValidation,
  invitationRoutes,
  outboxPayloads,
  outboxTypes,
  seedInvitation,
  seedUser,
  seedWorkspace,
  storedInvitation,
  storedMemberships,
  type TestHarness,
} from "./harness";

/** spec/testcases/workspace/revokeInvitation.md (TC-workspace-252〜258). */

const WORKSPACE = "workspace-1";
const OTHER_WORKSPACE = "workspace-2";
const OWNER = "owner-1";
const INVITATION = "invitation-1";
const INVITEE = "invitee@example.com";

const NOT_PENDING = "INVITATION_NOT_PENDING";
const NOT_FOUND = "INVITATION_NOT_FOUND";

const revoke = (
  h: TestHarness,
  overrides: Readonly<{
    workspaceId?: string;
    userId?: string;
    invitationId?: string;
  }> = {},
  container: RequestContainer = h.container,
): Promise<void> =>
  revokeInvitation({
    container,
    input: {
      workspaceId: overrides.workspaceId ?? WORKSPACE,
      userId: overrides.userId ?? OWNER,
      invitationId: overrides.invitationId ?? INVITATION,
    },
  });

const seedOwnedWorkspace = (h: TestHarness, workspaceId = WORKSPACE) =>
  seedWorkspace(h, {
    workspaceId,
    members: [{ userId: OWNER, role: "owner" }],
  });

describe("revokeInvitation", () => {
  it("TC-workspace-252: the invitation becomes revoked and emits invitation.revoked", async () => {
    const h = createWorkspaceHarness();
    await seedOwnedWorkspace(h);
    await seedInvitation(h, WORKSPACE, { invitedBy: OWNER, email: INVITEE });

    await revoke(h);

    expect(storedInvitation(h, WORKSPACE, INVITATION)).toMatchObject({
      status: "revoked",
      revokedAt: h.clock.now(),
    });
    expect(outboxTypes(h)).toContain("workspace.invitation.revoked");
    expect(outboxPayloads(h, "workspace.invitation.revoked")).toEqual([
      { invitationId: INVITATION, workspaceId: WORKSPACE },
    ]);
    expect(invitationRoutes(h).map((row) => row.state)).toEqual(["revoked"]);
  });

  it("TC-workspace-253: the link no longer opens once the route is closed", async () => {
    const h = createWorkspaceHarness();
    await seedOwnedWorkspace(h);
    seedUser(h, { userId: "joiner-1" });
    const seeded = await seedInvitation(h, WORKSPACE, { invitedBy: OWNER });

    await revoke(h);

    // A closed route resolves to nothing, so preview and accept answer
    // INVITATION_NOT_FOUND uniformly (ports/invitationRouteStore.ts).
    await expectNotFound(
      getInvitationPreview({
        container: h.container,
        input: { token: seeded.token, userId: null },
      }),
      NOT_FOUND,
    );
    await expectNotFound(
      acceptInvitation({
        container: h.container,
        input: { token: seeded.token, userId: "joiner-1" },
      }),
      NOT_FOUND,
    );
  });

  it("TC-workspace-254: an accepted invitation is INVITATION_NOT_PENDING", async () => {
    const h = createWorkspaceHarness();
    await seedOwnedWorkspace(h);
    await seedInvitation(h, WORKSPACE, {
      invitedBy: OWNER,
      state: "accepted",
      acceptedBy: OWNER,
    });

    await expectValidation(revoke(h), NOT_PENDING);
    expect(storedInvitation(h, WORKSPACE, INVITATION)).toMatchObject({
      status: "accepted",
    });
  });

  it("TC-workspace-255: an unknown or foreign invitation id is INVITATION_NOT_FOUND", async () => {
    const h = createWorkspaceHarness();
    await seedOwnedWorkspace(h);
    await seedOwnedWorkspace(h, OTHER_WORKSPACE);
    await seedInvitation(h, OTHER_WORKSPACE, {
      invitationId: "foreign-invitation",
      invitedBy: OWNER,
    });

    await expectNotFound(revoke(h, { invitationId: "no-such-id" }), NOT_FOUND);
    await expectNotFound(
      revoke(h, { invitationId: "foreign-invitation" }),
      NOT_FOUND,
    );
    expect(
      storedInvitation(h, OTHER_WORKSPACE, "foreign-invitation"),
    ).toMatchObject({ status: "pending" });
  });

  it("TC-workspace-256: a member below manageMembers is refused", async () => {
    const h = createWorkspaceHarness();
    await seedWorkspace(h, {
      workspaceId: WORKSPACE,
      members: [
        { userId: OWNER, role: "owner" },
        { userId: "editor-1", role: "editor" },
      ],
    });
    await seedInvitation(h, WORKSPACE, { invitedBy: OWNER });

    await expectBusinessRule(
      revoke(h, { userId: "editor-1" }),
      "WORKSPACE_INSUFFICIENT_ROLE",
    );
    expect(storedInvitation(h, WORKSPACE, INVITATION)).toMatchObject({
      status: "pending",
    });
    expect(invitationRoutes(h).map((row) => row.state)).toEqual(["active"]);
  });

  it("TC-workspace-257: the address is invitable again, as a new invitation", async () => {
    const h = createWorkspaceHarness();
    await seedOwnedWorkspace(h);
    await seedInvitation(h, WORKSPACE, { invitedBy: OWNER, email: INVITEE });
    await revoke(h);

    const issued = await inviteMember({
      container: h.container,
      input: {
        workspaceId: WORKSPACE,
        userId: OWNER,
        email: INVITEE,
        role: "viewer",
      },
    });

    // A revoked row is terminal, so `findPendingByWorkspaceAndEmail` misses
    // it and this is an issue rather than the tail-call resend of TC-135.
    expect(issued.invitationId).not.toBe(INVITATION);
    expect(storedInvitation(h, WORKSPACE, issued.invitationId)).toMatchObject({
      status: "pending",
      email: INVITEE,
      role: "viewer",
    });
    expect(storedInvitation(h, WORKSPACE, INVITATION)).toMatchObject({
      status: "revoked",
    });
  });

  it("TC-workspace-258: the local revoke already refuses accept while the route close is still in flight", async () => {
    const h = createWorkspaceHarness();
    await seedOwnedWorkspace(h);
    seedUser(h, { userId: "joiner-1" });
    const seeded = await seedInvitation(h, WORKSPACE, { invitedBy: OWNER });
    const routes = h.container.invitationRouteStore;
    const operationIds: string[] = [];
    let inFlightRouteState: string | undefined;
    let acceptDuringWindow: unknown;
    const container: RequestContainer = {
      ...h.container,
      invitationRouteStore: {
        ...routes,
        revoke: async (input) => {
          operationIds.push(input.operationId);
          if (acceptDuringWindow === undefined) {
            // The commit landed, the route has not been closed yet: the
            // authoritative Invitation is what has to refuse the link.
            inFlightRouteState = invitationRoutes(h).find(
              (row) => row.tokenHash === seeded.tokenHash,
            )?.state;
            acceptDuringWindow = await acceptInvitation({
              container: h.container,
              input: { token: seeded.token, userId: "joiner-1" },
            }).catch((error: unknown) => error);
            throw new Error("revoke response lost");
          }
          await routes.revoke(input);
        },
      },
    };

    await revoke(h, {}, container);

    expect(inFlightRouteState).toBe("active");
    expect(acceptDuringWindow).toSatisfy(
      (error: unknown) =>
        isValidationError(error) && error.code === NOT_PENDING,
    );
    expect(operationIds).toHaveLength(2);
    expect(operationIds[0]).toBe(operationIds[1]);
    expect(invitationRoutes(h).map((row) => row.state)).toEqual(["revoked"]);
    // The refused accept left no membership behind.
    expect(storedMemberships(h, WORKSPACE).map((m) => m.userId)).toEqual([
      OWNER,
    ]);
    expect(h.logger.entries.map((entry) => entry.message)).toContain(
      "[revokeInvitation] revoke route response lost; retrying once",
    );
  });
});
