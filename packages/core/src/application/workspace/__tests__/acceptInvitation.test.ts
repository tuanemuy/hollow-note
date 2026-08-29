import { UserId } from "@repo/core/domain/identity/valueObject";
import { WorkspaceId } from "@repo/core/domain/workspace/valueObject";
import { describe, expect, it } from "vitest";
import type { RequestContainer } from "../../di/types";
import { isConflictError } from "../../errors";
import type { ScopeUnitOfWorkProvider } from "../../execution/unitOfWork";
import { markDeleting } from "../../identity/__tests__/authFlowHelpers";
import { createBlankNote } from "../../note/createBlankNote";
import { acceptInvitation } from "../acceptInvitation";
import { resolveWorkspaceAccess } from "../resolveWorkspaceAccess";
import type { AcceptedInvitationView } from "../view";
import {
  createWorkspaceHarness,
  expectBusinessRule,
  expectNotFound,
  expectValidation,
  invitationRoutes,
  membershipEdges,
  outboxTypes,
  removeWorkspaceRow,
  seedInvitation,
  seedUser,
  seedWorkspace,
  storedInvitation,
  storedMemberships,
  type TestHarness,
} from "./harness";

/**
 * spec/testcases/workspace/acceptInvitation.md (TC-workspace-001〜020).
 *
 * TC-workspace-017 / 018 are not expressible against a usecase: neither a
 * lapsed activation lease nor the interleaving of an account deletion with
 * an activation claim is driven from here. Both are the
 * `MembershipDirectoryReservationStore` contract's own
 * (`adapters/conformance/membershipDirectoryReservationStore.ts`,
 * ADP-workspace-036〜040).
 */

const WORKSPACE = "workspace-1";
const OTHER_WORKSPACE = "workspace-2";
const OWNER = "owner-1";
const JOINER = "joiner-1";
const INVITATION = "invitation-1";

const NOT_FOUND = "INVITATION_NOT_FOUND";
const NOT_PENDING = "INVITATION_NOT_PENDING";

const accept = (
  h: TestHarness,
  token: string,
  userId: string = JOINER,
  container: RequestContainer = h.container,
): Promise<AcceptedInvitationView> =>
  acceptInvitation({ container, input: { token, userId } });

const seedOwnedWorkspace = (h: TestHarness, workspaceId = WORKSPACE) =>
  seedWorkspace(h, {
    workspaceId,
    members: [{ userId: OWNER, role: "owner" }],
  });

/** An owned workspace, a live invitation into it, and the invitee's account. */
async function seedJoinable(
  h: TestHarness,
  options: Readonly<{
    workspaceId?: string;
    invitationId?: string;
    role?: "owner" | "editor" | "viewer";
    state?: "pending" | "expired" | "revoked" | "accepted";
    route?: "active" | "reserved" | "closed" | "none";
    joiner?: string;
  }> = {},
) {
  const workspaceId = options.workspaceId ?? WORKSPACE;
  await seedOwnedWorkspace(h, workspaceId);
  seedUser(h, { userId: options.joiner ?? JOINER });
  return seedInvitation(h, workspaceId, {
    invitationId: options.invitationId ?? INVITATION,
    invitedBy: OWNER,
    role: options.role ?? "editor",
    ...(options.state !== undefined ? { state: options.state } : {}),
    ...(options.route !== undefined ? { route: options.route } : {}),
  });
}

describe("acceptInvitation", () => {
  it("TC-workspace-001: one route read resolves the single scope the accept touches", async () => {
    const h = createWorkspaceHarness();
    const seeded = await seedJoinable(h);
    await seedOwnedWorkspace(h, OTHER_WORKSPACE);
    await seedInvitation(h, OTHER_WORKSPACE, {
      invitationId: "invitation-other",
      email: "other@example.com",
      invitedBy: OWNER,
    });
    const routes = h.container.invitationRouteStore;
    const resolved: (string | null)[] = [];
    const container: RequestContainer = {
      ...h.container,
      invitationRouteStore: {
        ...routes,
        resolveActive: async (tokenHash) => {
          const target = await routes.resolveActive(tokenHash);
          resolved.push(target?.workspaceId ?? null);
          return target;
        },
      },
    };

    await accept(h, seeded.token, JOINER, container);

    expect(resolved).toEqual([WORKSPACE]);
    expect(storedMemberships(h, WORKSPACE).map((m) => m.userId)).toEqual([
      OWNER,
      JOINER,
    ]);
    expect(storedMemberships(h, OTHER_WORKSPACE).map((m) => m.userId)).toEqual([
      OWNER,
    ]);
  });

  it("TC-workspace-013: the route decides the scope, not the invitation id", async () => {
    const h = createWorkspaceHarness();
    // Both workspaces hold an invitation under the same local id.
    await seedJoinable(h);
    await seedOwnedWorkspace(h, OTHER_WORKSPACE);
    const target = await seedInvitation(h, OTHER_WORKSPACE, {
      invitationId: INVITATION,
      email: "other@example.com",
      role: "viewer",
      invitedBy: OWNER,
    });

    const view = await accept(h, target.token);

    expect(view).toEqual({ workspaceId: OTHER_WORKSPACE, role: "viewer" });
    expect(storedInvitation(h, OTHER_WORKSPACE, INVITATION)).toMatchObject({
      status: "accepted",
    });
    expect(storedInvitation(h, WORKSPACE, INVITATION)).toMatchObject({
      status: "pending",
    });
  });

  it("TC-workspace-002: the consumed token cannot be redeemed a second time", async () => {
    const h = createWorkspaceHarness();
    const seeded = await seedJoinable(h);

    await accept(h, seeded.token);

    expect(invitationRoutes(h).map((row) => row.state)).toEqual(["revoked"]);
    await expectNotFound(accept(h, seeded.token, "second-1"), NOT_FOUND);
    expect(storedMemberships(h, WORKSPACE)).toHaveLength(2);
  });

  it("TC-workspace-003: a lost consume response is repaired under the same operation id", async () => {
    const h = createWorkspaceHarness();
    const seeded = await seedJoinable(h);
    const routes = h.container.invitationRouteStore;
    const operationIds: string[] = [];
    let dropped = false;
    const container: RequestContainer = {
      ...h.container,
      invitationRouteStore: {
        ...routes,
        consume: async (input) => {
          operationIds.push(input.operationId);
          await routes.consume(input);
          if (!dropped) {
            dropped = true;
            throw new Error("consume response lost");
          }
        },
      },
    };

    await accept(h, seeded.token, JOINER, container);

    expect(operationIds).toHaveLength(2);
    expect(operationIds[0]).toBe(operationIds[1]);
    expect(invitationRoutes(h).map((row) => row.state)).toEqual(["revoked"]);
    expect(storedMemberships(h, WORKSPACE)).toHaveLength(2);
    expect(h.logger.entries.map((entry) => entry.message)).toContain(
      "[acceptInvitation] consume response lost; retrying once",
    );
  });

  it("TC-workspace-004: the membership is created, the invitation settles, and the offered role applies", async () => {
    const h = createWorkspaceHarness();
    const seeded = await seedJoinable(h, { role: "viewer" });

    const view = await accept(h, seeded.token);

    expect(view).toEqual({ workspaceId: WORKSPACE, role: "viewer" });
    expect(storedInvitation(h, WORKSPACE, INVITATION)).toMatchObject({
      status: "accepted",
      acceptedBy: JOINER,
      acceptedAt: h.clock.now(),
    });
    const joined = storedMemberships(h, WORKSPACE).find(
      (m) => m.userId === JOINER,
    );
    expect(joined).toMatchObject({ role: "viewer", workspaceId: WORKSPACE });
    expect(membershipEdges(h, JOINER)).toEqual([
      expect.objectContaining({
        workspaceId: WORKSPACE,
        edgeState: "active",
        role: "viewer",
        membershipId: joined?.id,
      }),
    ]);
    expect(outboxTypes(h)).toEqual(
      expect.arrayContaining([
        "workspace.invitation.accepted",
        "workspace.membership.added",
      ]),
    );
  });

  it("TC-workspace-005: the link authorizes, so a mismatched signed-in address still joins", async () => {
    const h = createWorkspaceHarness();
    await seedOwnedWorkspace(h);
    seedUser(h, { userId: JOINER, email: "someone-else@example.com" });
    const seeded = await seedInvitation(h, WORKSPACE, {
      invitedBy: OWNER,
      email: "invited@example.com",
      role: "editor",
    });

    const view = await accept(h, seeded.token);

    expect(view).toEqual({ workspaceId: WORKSPACE, role: "editor" });
    expect(storedInvitation(h, WORKSPACE, INVITATION)).toMatchObject({
      email: "invited@example.com",
      acceptedBy: JOINER,
    });
  });

  it("TC-workspace-006: a token that never opened is INVITATION_NOT_FOUND", async () => {
    const h = createWorkspaceHarness();
    await seedJoinable(h);

    await expectNotFound(accept(h, "never-issued-token"), NOT_FOUND);
    expect(membershipEdges(h, JOINER)).toHaveLength(0);
  });

  it("TC-workspace-007: an expired invitation is InvitationExpired, and the claimed edge is released", async () => {
    const h = createWorkspaceHarness();
    const seeded = await seedJoinable(h, { state: "expired" });

    await expectBusinessRule(
      accept(h, seeded.token),
      "WORKSPACE_INVITATION_EXPIRED",
    );
    expect(storedInvitation(h, WORKSPACE, INVITATION)).toMatchObject({
      status: "pending",
    });
    expect(membershipEdges(h, JOINER)).toHaveLength(0);
    expect(storedMemberships(h, WORKSPACE)).toHaveLength(1);
  });

  it("TC-workspace-008: a revoked invitation whose route is still open is INVITATION_NOT_PENDING", async () => {
    const h = createWorkspaceHarness();
    const seeded = await seedJoinable(h, { state: "revoked", route: "active" });

    await expectValidation(accept(h, seeded.token), NOT_PENDING);
    expect(membershipEdges(h, JOINER)).toHaveLength(0);
    expect(storedMemberships(h, WORKSPACE)).toHaveLength(1);
  });

  it("TC-workspace-009: an existing member settles the invitation and keeps the role they hold", async () => {
    const h = createWorkspaceHarness();
    await seedWorkspace(h, {
      workspaceId: WORKSPACE,
      members: [
        { userId: OWNER, role: "owner", membershipId: "m-owner" },
        { userId: JOINER, role: "viewer", membershipId: "m-joiner" },
      ],
    });
    const seeded = await seedInvitation(h, WORKSPACE, {
      invitedBy: OWNER,
      role: "owner",
    });

    const view = await accept(h, seeded.token);

    expect(view).toEqual({ workspaceId: WORKSPACE, role: "viewer" });
    expect(storedInvitation(h, WORKSPACE, INVITATION)).toMatchObject({
      status: "accepted",
    });
    expect(storedMemberships(h, WORKSPACE)).toHaveLength(2);
    expect(
      storedMemberships(h, WORKSPACE).find((m) => m.userId === JOINER),
    ).toMatchObject({ id: "m-joiner", role: "viewer" });
    expect(invitationRoutes(h).map((row) => row.state)).toEqual(["revoked"]);
  });

  it("TC-workspace-010: a workspace the deletion saga removed is WORKSPACE_NOT_FOUND", async () => {
    const h = createWorkspaceHarness();
    const seeded = await seedJoinable(h);
    removeWorkspaceRow(h, WORKSPACE);

    await expectNotFound(accept(h, seeded.token), "WORKSPACE_NOT_FOUND");
    expect(membershipEdges(h, JOINER)).toHaveLength(0);
  });

  it("TC-workspace-011: two concurrent accepts of one invitation create a single membership", async () => {
    const h = createWorkspaceHarness();
    const seeded = await seedJoinable(h);

    const outcomes = await Promise.allSettled([
      accept(h, seeded.token),
      accept(h, seeded.token),
    ]);

    expect(outcomes.filter((o) => o.status === "fulfilled")).toHaveLength(1);
    // The loser is stopped on the invitee's shard, before any
    // workspace-local write — not by the invitation's OCC afterwards.
    expect(outcomes.find((o) => o.status === "rejected")?.reason).toSatisfy(
      (error: unknown) =>
        isConflictError(error) && error.code === "MEMBERSHIP_ALREADY_EXISTS",
    );
    expect(storedMemberships(h, WORKSPACE).map((m) => m.userId)).toEqual([
      OWNER,
      JOINER,
    ]);
    expect(membershipEdges(h, JOINER)).toHaveLength(1);
    expect(membershipEdges(h, JOINER)[0]?.edgeState).toBe("active");
    expect(storedInvitation(h, WORKSPACE, INVITATION)).toMatchObject({
      status: "accepted",
    });
  });

  it("TC-workspace-012: the granted role gates what the new member may do", async () => {
    const h = createWorkspaceHarness();
    const editorInvite = await seedJoinable(h, { role: "editor" });
    await seedOwnedWorkspace(h, OTHER_WORKSPACE);
    const viewerInvite = await seedInvitation(h, OTHER_WORKSPACE, {
      invitationId: "invitation-viewer",
      email: "viewer@example.com",
      invitedBy: OWNER,
      role: "viewer",
    });

    await accept(h, editorInvite.token);
    await accept(h, viewerInvite.token);

    await expect(
      resolveWorkspaceAccess({
        container: h.container,
        input: { workspaceId: WORKSPACE, userId: JOINER },
      }),
    ).resolves.toMatchObject({ role: "editor" });

    const note = await createBlankNote({
      container: h.container,
      input: {
        userId: JOINER,
        ownerType: "workspace",
        ownerWorkspaceId: WORKSPACE,
        title: null,
      },
    });
    expect(note.noteId).toBeTypeOf("string");

    await expectBusinessRule(
      createBlankNote({
        container: h.container,
        input: {
          userId: JOINER,
          ownerType: "workspace",
          ownerWorkspaceId: OTHER_WORKSPACE,
          title: null,
        },
      }),
      "WORKSPACE_INSUFFICIENT_ROLE",
    );
  });

  it("TC-workspace-014: an invitee whose account is deleting leaves no edge at all", async () => {
    const h = createWorkspaceHarness();
    const seeded = await seedJoinable(h);
    markDeleting(h, JOINER);

    await expect(accept(h, seeded.token)).rejects.toSatisfy(isConflictError);
    expect(membershipEdges(h, JOINER)).toHaveLength(0);
    expect(storedInvitation(h, WORKSPACE, INVITATION)).toMatchObject({
      status: "pending",
    });
    expect(storedMemberships(h, WORKSPACE)).toHaveLength(1);
  });

  it("TC-workspace-015: an edge an account deletion already decided about makes the join lose", async () => {
    const h = createWorkspaceHarness();
    const seeded = await seedJoinable(h);
    // A pending edge under a deletion prepare lock — the state a deletion
    // reaches after it drained the shard's activating edges to zero.
    h.backend.membershipEdges.set(`${JOINER} edge-prepared`, {
      userId: UserId.create(JOINER),
      edgeKey: "edge-prepared",
      workspaceId: WorkspaceId.create(WORKSPACE),
      edgeState: "pending",
      membershipId: null,
      role: "viewer",
      deletionPrepareOperationId: "deletion-1",
      deletionPrepareExpiresAt: new Date(h.clock.now().getTime() + 600_000),
      reservationExpiresAt: new Date(h.clock.now().getTime() + 600_000),
      createdAt: h.clock.now(),
    });

    await expect(accept(h, seeded.token)).rejects.toSatisfy(isConflictError);
    expect(storedInvitation(h, WORKSPACE, INVITATION)).toMatchObject({
      status: "pending",
    });
    expect(storedMemberships(h, WORKSPACE)).toHaveLength(1);
    // The deletion's edge is untouched by the join that lost.
    expect(membershipEdges(h, JOINER)).toEqual([
      expect.objectContaining({
        edgeKey: "edge-prepared",
        edgeState: "pending",
        deletionPrepareOperationId: "deletion-1",
      }),
    ]);
  });

  it("TC-workspace-016: the edge is enumerable as activating until the scope commit settles it", async () => {
    const h = createWorkspaceHarness();
    const seeded = await seedJoinable(h);
    const provider = h.container.scopeUnitOfWorkProvider;
    const store = h.container.membershipDirectoryReservationStore;
    const joiner = UserId.create(JOINER);
    let duringCommit: readonly { operationId: string; workspaceId: string }[] =
      [];
    const observing: ScopeUnitOfWorkProvider = {
      run: async (scope, fn) => {
        // An account deletion drains exactly this list before it fixes its
        // manifest, so the claim has to be visible here.
        duringCommit = await store.listActivatingByUser(joiner, 100);
        return provider.run(scope, fn);
      },
    };

    await accept(h, seeded.token, JOINER, {
      ...h.container,
      scopeUnitOfWorkProvider: observing,
    });

    expect(duringCommit.map((edge) => edge.workspaceId)).toEqual([WORKSPACE]);
    expect(await store.listActivatingByUser(joiner, 100)).toHaveLength(0);
    expect(membershipEdges(h, JOINER)[0]?.edgeState).toBe("active");
  });

  it("TC-workspace-019: a commit that never lands releases the edge and leaves the invitation pending", async () => {
    const h = createWorkspaceHarness();
    const seeded = await seedJoinable(h);
    const failing: ScopeUnitOfWorkProvider = {
      run: async () => {
        throw new Error("scope commit lost");
      },
    };

    await expect(
      accept(h, seeded.token, JOINER, {
        ...h.container,
        scopeUnitOfWorkProvider: failing,
      }),
    ).rejects.toThrow("scope commit lost");

    expect(membershipEdges(h, JOINER)).toHaveLength(0);
    expect(storedInvitation(h, WORKSPACE, INVITATION)).toMatchObject({
      status: "pending",
    });
    expect(invitationRoutes(h).map((row) => row.state)).toEqual(["active"]);
  });

  it("TC-workspace-020: a lost activate response settles the same edge without a second membership", async () => {
    const h = createWorkspaceHarness();
    const seeded = await seedJoinable(h);
    const store = h.container.membershipDirectoryReservationStore;
    const operationIds: string[] = [];
    let dropped = false;
    const container: RequestContainer = {
      ...h.container,
      membershipDirectoryReservationStore: {
        ...store,
        activate: async (operationId) => {
          operationIds.push(operationId);
          await store.activate(operationId);
          if (!dropped) {
            dropped = true;
            throw new Error("activate response lost");
          }
        },
      },
    };

    await accept(h, seeded.token, JOINER, container);

    expect(operationIds).toHaveLength(2);
    expect(operationIds[0]).toBe(operationIds[1]);
    expect(membershipEdges(h, JOINER)).toHaveLength(1);
    expect(membershipEdges(h, JOINER)[0]?.edgeState).toBe("active");
    expect(storedMemberships(h, WORKSPACE)).toHaveLength(2);
    expect(h.logger.entries.map((entry) => entry.message)).toContain(
      "[acceptInvitation] activate edge response lost; retrying once",
    );
  });
});
