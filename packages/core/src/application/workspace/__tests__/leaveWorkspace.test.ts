import { UserId } from "@repo/core/domain/identity/valueObject";
import type { WorkspaceId } from "@repo/core/domain/workspace/valueObject";
import { describe, expect, it } from "vitest";
import { isConflictError } from "../../errors";
import { createBlankNote } from "../../note/createBlankNote";
import { getNote } from "../../note/getNote";
import { acceptInvitation } from "../acceptInvitation";
import { leaveWorkspace } from "../leaveWorkspace";
import { listUserWorkspaces } from "../listUserWorkspaces";
import { resolveWorkspaceAccess } from "../resolveWorkspaceAccess";
import {
  createWorkspaceHarness,
  expectBusinessRule,
  expectNotFound,
  membershipEdges,
  outboxPayloads,
  seedInvitation,
  seedWorkspace,
  storedMembership,
  storedMemberships,
  type TestHarness,
} from "./harness";

/**
 * spec/testcases/workspace/leaveWorkspace.md (TC-workspace-147〜168).
 *
 * TC-workspace-153〜162 describe the departing member's unfinished jobs;
 * the Job aggregate does not exist in this slice, so the sweep is recorded
 * as absent in `membershipMutation.ts` rather than emitted. TC-workspace-167
 * (residue left behind by job history / backup records) has nothing to
 * leave residue: neither the Job aggregate nor the BackupRecord exists
 * yet, so the acknowledgement TC-workspace-168 waits on is given from the
 * start and `completeRemoval` runs straight after the local commit.
 */

const WORKSPACE = "workspace-1";
const OTHER_WORKSPACE = "workspace-2";
const OWNER = "owner-1";
const SECOND_OWNER = "owner-2";
const EDITOR = "editor-1";

const MEMBERSHIP_REMOVED = "workspace.membership.removed";

const leave = (h: TestHarness, userId: string, workspaceId = WORKSPACE) =>
  leaveWorkspace({ container: h.container, input: { workspaceId, userId } });

const seed = (h: TestHarness) =>
  seedWorkspace(h, {
    workspaceId: WORKSPACE,
    members: [
      { userId: OWNER, role: "owner", membershipId: "m-owner" },
      { userId: EDITOR, role: "editor", membershipId: "m-editor" },
    ],
  });

const edgeOf = (h: TestHarness, userId: string, workspaceId = WORKSPACE) =>
  membershipEdges(h, userId).find((row) => row.workspaceId === workspaceId) ??
  null;

describe("leaveWorkspace", () => {
  it("TC-workspace-147: an editor leaves — the edge is announced `removing` before the Membership is deleted", async () => {
    const h = createWorkspaceHarness();
    await seed(h);

    const store = h.container.membershipDirectoryReservationStore;
    const seen: string[] = [];
    const container = {
      ...h.container,
      membershipDirectoryReservationStore: {
        ...store,
        beginRemoval: async (userId: UserId, workspaceId: WorkspaceId) => {
          await store.beginRemoval(userId, workspaceId);
          seen.push(
            `begin:${edgeOf(h, EDITOR)?.edgeState}:${
              storedMembership(h, WORKSPACE, "m-editor") === null
            }`,
          );
        },
      },
    };

    await leaveWorkspace({
      container,
      input: { workspaceId: WORKSPACE, userId: EDITOR },
    });

    expect(seen).toEqual(["begin:removing:false"]);
    expect(storedMembership(h, WORKSPACE, "m-editor")).toBeNull();
    expect(edgeOf(h, EDITOR)).toBeNull();
    expect(outboxPayloads(h, MEMBERSHIP_REMOVED)).toEqual([
      { workspaceId: WORKSPACE, userId: EDITOR },
    ]);
  });

  it("TC-workspace-148: the only owner cannot leave, and the edge is not announced", async () => {
    const h = createWorkspaceHarness();
    await seed(h);

    await expectBusinessRule(
      leave(h, OWNER),
      "WORKSPACE_LAST_OWNER_CANNOT_LEAVE",
    );
    expect(storedMembership(h, WORKSPACE, "m-owner")).not.toBeNull();
    expect(edgeOf(h, OWNER)?.edgeState).toBe("active");
  });

  it("TC-workspace-149: one of two owners may leave, and the survivor then may not", async () => {
    const h = createWorkspaceHarness();
    await seedWorkspace(h, {
      workspaceId: WORKSPACE,
      members: [
        { userId: OWNER, role: "owner", membershipId: "m-owner" },
        { userId: SECOND_OWNER, role: "owner", membershipId: "m-owner-2" },
      ],
    });

    await expect(leave(h, SECOND_OWNER)).resolves.toBeUndefined();
    expect(storedMemberships(h, WORKSPACE).map((m) => m.id)).toEqual([
      "m-owner",
    ]);

    await expectBusinessRule(
      leave(h, OWNER),
      "WORKSPACE_LAST_OWNER_CANNOT_LEAVE",
    );
  });

  /**
   * The last-owner rule is evaluated twice, and only the second
   * evaluation sees the other owner's departure. The announcement is
   * already made by then, so it has to be taken back — the refused
   * departure leaves a member who still holds the workspace, and nothing
   * else walks an edge out of `removing`.
   */
  it("TC-workspace-149: an owner who became the last one after the announcement keeps their edge", async () => {
    const h = createWorkspaceHarness();
    await seedWorkspace(h, {
      workspaceId: WORKSPACE,
      members: [
        { userId: OWNER, role: "owner", membershipId: "m-owner" },
        { userId: SECOND_OWNER, role: "owner", membershipId: "m-owner-2" },
      ],
    });

    const store = h.container.membershipDirectoryReservationStore;
    const container = {
      ...h.container,
      membershipDirectoryReservationStore: {
        ...store,
        beginRemoval: async (userId: UserId, workspaceId: WorkspaceId) => {
          await store.beginRemoval(userId, workspaceId);
          // The other owner leaves in the window the announcement opens.
          await leave(h, OWNER);
        },
      },
    };

    await expectBusinessRule(
      leaveWorkspace({
        container,
        input: { workspaceId: WORKSPACE, userId: SECOND_OWNER },
      }),
      "WORKSPACE_LAST_OWNER_CANNOT_LEAVE",
    );

    expect(storedMembership(h, WORKSPACE, "m-owner-2")).not.toBeNull();
    // The workspace is back in the list of the owner who never left.
    expect(edgeOf(h, SECOND_OWNER)?.edgeState).toBe("active");
    await expect(
      listUserWorkspaces({
        container: h.container,
        input: { userId: SECOND_OWNER },
      }),
    ).resolves.toMatchObject({
      workspaces: [{ workspaceId: WORKSPACE, role: "owner" }],
    });
  });

  it("TC-workspace-150: someone who never joined gets MEMBERSHIP_NOT_FOUND", async () => {
    const h = createWorkspaceHarness();
    await seed(h);

    await expectNotFound(leave(h, "outsider-1"), "MEMBERSHIP_NOT_FOUND");
    // Leaving twice is the same answer — the second call has nothing left.
    await leave(h, EDITOR);
    await expectNotFound(leave(h, EDITOR), "MEMBERSHIP_NOT_FOUND");
  });

  it("TC-workspace-151: the workspace's notes stop resolving for the departed member", async () => {
    const h = createWorkspaceHarness();
    await seed(h);
    const note = await createBlankNote({
      container: h.container,
      input: {
        userId: OWNER,
        ownerType: "workspace",
        ownerWorkspaceId: WORKSPACE,
        title: "shared",
      },
    });

    await expect(
      getNote({
        container: h.container,
        input: { noteId: note.noteId, userId: EDITOR },
      }),
    ).resolves.toMatchObject({ noteId: note.noteId });

    await leave(h, EDITOR);

    await expectNotFound(
      getNote({
        container: h.container,
        input: { noteId: note.noteId, userId: EDITOR },
      }),
      "NOTE_NOT_FOUND",
    );
  });

  it("TC-workspace-152: notes the leaver created stay with the workspace", async () => {
    const h = createWorkspaceHarness();
    await seed(h);
    const note = await createBlankNote({
      container: h.container,
      input: {
        userId: EDITOR,
        ownerType: "workspace",
        ownerWorkspaceId: WORKSPACE,
        title: "written before leaving",
      },
    });

    await leave(h, EDITOR);

    await expect(
      getNote({
        container: h.container,
        input: { noteId: note.noteId, userId: OWNER },
      }),
    ).resolves.toMatchObject({
      noteId: note.noteId,
      ownerType: "workspace",
      createdBy: EDITOR,
    });
  });

  it("TC-workspace-163: the workspace leaves listUserWorkspaces, and the others stay", async () => {
    const h = createWorkspaceHarness();
    await seed(h);
    await seedWorkspace(h, {
      workspaceId: OTHER_WORKSPACE,
      members: [
        { userId: OWNER, role: "owner", membershipId: "m2-owner" },
        { userId: EDITOR, role: "editor", membershipId: "m2-editor" },
      ],
    });

    await leave(h, EDITOR);

    await expect(
      listUserWorkspaces({ container: h.container, input: { userId: EDITOR } }),
    ).resolves.toMatchObject({
      workspaces: [{ workspaceId: OTHER_WORKSPACE, role: "editor" }],
      hasMore: false,
    });
  });

  it("TC-workspace-164: resolveWorkspaceAccess answers role null, not an error", async () => {
    const h = createWorkspaceHarness();
    await seed(h);

    await leave(h, EDITOR);

    await expect(
      resolveWorkspaceAccess({
        container: h.container,
        input: { workspaceId: WORKSPACE, userId: EDITOR },
      }),
    ).resolves.toMatchObject({ workspaceId: WORKSPACE, role: null });
  });

  it("TC-workspace-165: rejoining needs a fresh invitation — no route survives the departure", async () => {
    const h = createWorkspaceHarness();
    await seed(h);

    await leave(h, EDITOR);

    await expectNotFound(
      acceptInvitation({
        container: h.container,
        input: { token: "no-such-token", userId: EDITOR },
      }),
      "INVITATION_NOT_FOUND",
    );
  });

  it("TC-workspace-166 / TC-workspace-308: a failed edge drop leaves the scope's verdict final and the edge collectable by a retry", async () => {
    const h = createWorkspaceHarness();
    await seed(h);

    const store = h.container.membershipDirectoryReservationStore;
    let failOnce = true;
    const container = {
      ...h.container,
      membershipDirectoryReservationStore: {
        ...store,
        completeRemoval: async (userId: UserId, workspaceId: WorkspaceId) => {
          if (failOnce) {
            failOnce = false;
            throw new Error("directory shard unreachable");
          }
          await store.completeRemoval(userId, workspaceId);
        },
      },
    };

    await leaveWorkspace({
      container,
      input: { workspaceId: WORKSPACE, userId: EDITOR },
    });

    expect(storedMembership(h, WORKSPACE, "m-editor")).toBeNull();
    expect(edgeOf(h, EDITOR)?.edgeState).toBe("removing");
    await expect(
      resolveWorkspaceAccess({
        container: h.container,
        input: { workspaceId: WORKSPACE, userId: EDITOR },
      }),
    ).resolves.toMatchObject({ role: null });

    // TC-workspace-168: leaving again is the request that settles it. The
    // membership is gone either way, so the answer is unchanged — but the
    // edge it left behind is what held `(userId, workspaceId)` against a
    // future join, and it is dropped before the refusal is raised.
    await expectNotFound(leave(h, EDITOR), "MEMBERSHIP_NOT_FOUND");
    expect(edgeOf(h, EDITOR)).toBeNull();
  });

  it("TC-workspace-168: the settled edge frees the pair, so the departed member can be invited back", async () => {
    const h = createWorkspaceHarness();
    await seed(h);

    const store = h.container.membershipDirectoryReservationStore;
    await leaveWorkspace({
      container: {
        ...h.container,
        membershipDirectoryReservationStore: {
          ...store,
          completeRemoval: () =>
            Promise.reject(new Error("directory shard unreachable")),
        },
      },
      input: { workspaceId: WORKSPACE, userId: EDITOR },
    });
    expect(edgeOf(h, EDITOR)?.edgeState).toBe("removing");

    const invite = await seedInvitation(h, WORKSPACE, {
      invitationId: "invitation-rejoin",
      invitedBy: OWNER,
      role: "editor",
    });
    const rejoin = () =>
      acceptInvitation({
        container: h.container,
        input: { token: invite.token, userId: EDITOR },
      });

    // The stranded edge still claims `(userId, workspaceId)`, so the join
    // it announced is refused on the invitee's own shard.
    await expect(rejoin()).rejects.toSatisfy(
      (error: unknown) =>
        isConflictError(error) && error.code === "MEMBERSHIP_ALREADY_EXISTS",
    );

    await expectNotFound(leave(h, EDITOR), "MEMBERSHIP_NOT_FOUND");

    await expect(rejoin()).resolves.toMatchObject({
      workspaceId: WORKSPACE,
      role: "editor",
    });
  });

  it("TC-workspace-168: once the edge is dropped, an account deletion no longer enumerates the scope", async () => {
    const h = createWorkspaceHarness();
    await seed(h);
    const leaver = UserId.create(EDITOR);

    const fixTargets = async (operationId: string) => {
      await h.container.globalUnitOfWorkProvider.run((ctx) =>
        ctx.accountDeletionManifestStore.begin(operationId, leaver),
      );
      return h.container.globalUnitOfWorkProvider.run((ctx) =>
        ctx.accountDeletionManifestStore.appendMembershipPage(
          operationId,
          null,
          100,
        ),
      );
    };

    // The edge is what account deletion walks, so before the departure it
    // fixes this workspace as one of the leaver's targets.
    expect(await fixTargets("deletion-before")).toEqual({
      count: 1,
      nextCursor: null,
    });

    await leave(h, EDITOR);

    expect(membershipEdges(h, EDITOR)).toHaveLength(0);
    expect(await fixTargets("deletion-after")).toEqual({
      count: 0,
      nextCursor: null,
    });
    await expect(
      listUserWorkspaces({ container: h.container, input: { userId: EDITOR } }),
    ).resolves.toMatchObject({ workspaces: [] });
  });
});
