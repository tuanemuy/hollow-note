import { UserId } from "@repo/core/domain/identity/valueObject";
import type { WorkspaceId } from "@repo/core/domain/workspace/valueObject";
import { describe, expect, it } from "vitest";
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
 * leave residue, which is why TC-workspace-168's acknowledgement is
 * already given and `completeRemoval` runs straight after the local commit
 * (ADR 041 of this slice).
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

  it("TC-workspace-166: a failed edge drop leaves the scope's verdict final and the edge collectable by a retry", async () => {
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

    // TC-workspace-168: the drop is keyed on `(userId, workspaceId)`, so
    // the later attempt settles the same row without an operation id.
    await container.membershipDirectoryReservationStore.completeRemoval(
      // biome-ignore lint/style/noNonNullAssertion: seeded above
      membershipEdges(h, EDITOR)[0]!.userId,
      // biome-ignore lint/style/noNonNullAssertion: seeded above
      membershipEdges(h, EDITOR)[0]!.workspaceId,
    );
    expect(edgeOf(h, EDITOR)).toBeNull();
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
