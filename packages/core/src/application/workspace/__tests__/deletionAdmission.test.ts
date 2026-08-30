import { isConflictError } from "@repo/core/application/errors";
import { ScopeKey } from "@repo/core/application/scope";
import { UserId } from "@repo/core/domain/identity/valueObject";
import { Invitation } from "@repo/core/domain/workspace/invitation";
import { Membership } from "@repo/core/domain/workspace/membership";
import {
  MembershipId,
  WorkspaceId,
} from "@repo/core/domain/workspace/valueObject";
import { Workspace } from "@repo/core/domain/workspace/workspace";
import { beforeEach, describe, expect, it } from "vitest";
import { createTestHarness, type TestHarness } from "../../__tests__/helpers";
import { createBlankNote } from "../../note/createBlankNote";
import { acceptInvitation } from "../acceptInvitation";
import { changeMemberRole } from "../changeMemberRole";
import { changeWorkspaceSlug } from "../changeWorkspaceSlug";
import { inviteMember } from "../inviteMember";
import { leaveWorkspace } from "../leaveWorkspace";
import { publishWorkspace } from "../publishWorkspace";
import { removeMember } from "../removeMember";
import { resendInvitation } from "../resendInvitation";
import { revokeInvitation } from "../revokeInvitation";
import { unpublishWorkspace } from "../unpublishWorkspace";
import { updateWorkspaceProfile } from "../updateWorkspaceProfile";

/**
 * TC-workspace: 「deletion を受理して manifest を構築中に、招待発行・受諾、
 * member 変更、Note 作成を試す」→ すべて `WORKSPACE_DELETING`
 * (spec/testcases/workspace/deleteWorkspace.md).
 *
 * The barrier is `WorkspaceOperationLockStore.assertWritable`, which is a
 * different one from the account-deletion `cleanupAdmission` barrier the
 * same entry points also call: only this one turns true when the scope
 * itself is retiring, and a write admitted past it would land behind a
 * manifest cursor that has already gone by.
 */

const OWNER = "owner-1";
const MEMBER = "member-1";
const OUTSIDER = "outsider-1";
const WORKSPACE = "workspace-1";
const OPERATION = "deletion-op-1";

const workspaceId = WorkspaceId.create(WORKSPACE);
const scope = ScopeKey.workspace(workspaceId);

const expectWorkspaceDeleting = (promise: Promise<unknown>) =>
  expect(promise).rejects.toSatisfy(
    (error: unknown) =>
      isConflictError(error) && error.code === "WORKSPACE_DELETING",
  );

async function seed(h: TestHarness): Promise<{ token: string }> {
  const now = h.clock.now();
  const secret = h.container.secureTokenGenerator.issue();
  const invitation = Invitation.issue(
    {
      id: "invitation-1",
      workspaceId,
      email: "invitee@example.com",
      role: "viewer",
      invitedBy: UserId.create(OWNER),
      tokenHash: secret.hash,
    },
    now,
  ).entity;

  await h.container.scopeUnitOfWorkProvider.run(scope, async (ctx) => {
    await ctx.workspaceRepository.insert(
      Workspace.create(
        {
          id: WORKSPACE,
          ownerId: UserId.create(OWNER),
          name: "Workspace",
          description: "",
          slug: "team-alpha",
        },
        now,
      ).entity,
    );
    await ctx.membershipRepository.insert(
      Membership.create(
        {
          id: "membership-owner",
          workspaceId,
          userId: UserId.create(OWNER),
          role: "owner",
        },
        now,
      ).entity,
    );
    await ctx.membershipRepository.insert(
      Membership.create(
        {
          id: "membership-member",
          workspaceId,
          userId: UserId.create(MEMBER),
          role: "editor",
        },
        now,
      ).entity,
    );
    await ctx.invitationRepository.insert(invitation);
  });

  await h.container.invitationRouteStore.reserve({
    tokenHash: secret.hash,
    workspaceId,
    invitationId: invitation.id,
    operationId: "route-op-1",
    expiresAt: new Date(now.getTime() + 60_000),
  });
  await h.container.invitationRouteStore.activate({
    tokenHash: secret.hash,
    operationId: "route-op-1",
  });

  return { token: secret.token };
}

describe("workspace writes while the scope is deleting", () => {
  let h: TestHarness;
  let token: string;

  beforeEach(async () => {
    h = createTestHarness();
    ({ token } = await seed(h));
    await h.container.scopeUnitOfWorkProvider.run(scope, async (ctx) => {
      const versioned = await ctx.workspaceRepository.findById(workspaceId);
      await ctx.workspaceOperationLockStore.beginDeletion({
        workspaceId,
        operationId: OPERATION,
        expectedWorkspaceVersion: versioned?.expectedVersion ?? 0,
      });
    });
  });

  it("refuses inviteMember without claiming the invitation token", async () => {
    await expectWorkspaceDeleting(
      inviteMember({
        container: h.container,
        input: {
          workspaceId: WORKSPACE,
          userId: OWNER,
          email: "another@example.com",
          role: "viewer",
        },
      }),
    );
    expect(h.backend.invitationRoutes.size).toBe(1);
  });

  it("refuses resendInvitation", async () => {
    await expectWorkspaceDeleting(
      resendInvitation({
        container: h.container,
        input: {
          workspaceId: WORKSPACE,
          userId: OWNER,
          invitationId: "invitation-1",
        },
      }),
    );
  });

  it("refuses revokeInvitation", async () => {
    await expectWorkspaceDeleting(
      revokeInvitation({
        container: h.container,
        input: {
          workspaceId: WORKSPACE,
          userId: OWNER,
          invitationId: "invitation-1",
        },
      }),
    );
  });

  it("refuses acceptInvitation without claiming a directory edge", async () => {
    await expectWorkspaceDeleting(
      acceptInvitation({
        container: h.container,
        input: { token, userId: OUTSIDER },
      }),
    );
    expect(
      await h.container.membershipDirectoryReservationStore.listActivatingByUser(
        UserId.create(OUTSIDER),
        10,
      ),
    ).toHaveLength(0);
  });

  it("refuses changeMemberRole", async () => {
    await expectWorkspaceDeleting(
      changeMemberRole({
        container: h.container,
        input: {
          workspaceId: WORKSPACE,
          actorUserId: OWNER,
          membershipId: "membership-member",
          role: "viewer",
        },
      }),
    );
  });

  it("refuses removeMember before the directory edge is announced", async () => {
    await expectWorkspaceDeleting(
      removeMember({
        container: h.container,
        input: {
          workspaceId: WORKSPACE,
          actorUserId: OWNER,
          membershipId: "membership-member",
        },
      }),
    );
    expect(
      await h.container.scopeUnitOfWorkProvider.run(scope, (ctx) =>
        ctx.membershipRepository.findById(
          MembershipId.create("membership-member"),
        ),
      ),
    ).not.toBeNull();
  });

  it("refuses leaveWorkspace", async () => {
    await expectWorkspaceDeleting(
      leaveWorkspace({
        container: h.container,
        input: { workspaceId: WORKSPACE, userId: MEMBER },
      }),
    );
  });

  it("refuses updateWorkspaceProfile", async () => {
    await expectWorkspaceDeleting(
      updateWorkspaceProfile({
        container: h.container,
        input: { workspaceId: WORKSPACE, userId: OWNER, name: "Renamed" },
      }),
    );
  });

  it("refuses changeWorkspaceSlug", async () => {
    await expectWorkspaceDeleting(
      changeWorkspaceSlug({
        container: h.container,
        input: { workspaceId: WORKSPACE, userId: OWNER, slug: "team-beta" },
      }),
    );
  });

  it("refuses publishWorkspace and unpublishWorkspace", async () => {
    await expectWorkspaceDeleting(
      publishWorkspace({
        container: h.container,
        input: { workspaceId: WORKSPACE, userId: OWNER },
      }),
    );
    await expectWorkspaceDeleting(
      unpublishWorkspace({
        container: h.container,
        input: { workspaceId: WORKSPACE, userId: OWNER },
      }),
    );
  });

  it("refuses a note created in the retiring workspace", async () => {
    await expectWorkspaceDeleting(
      createBlankNote({
        container: h.container,
        input: {
          userId: OWNER,
          ownerType: "workspace",
          ownerWorkspaceId: WORKSPACE,
          title: null,
        },
      }),
    );
    expect(h.backend.scope(scope).notes.size).toBe(0);
  });
});
