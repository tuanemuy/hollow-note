import type { UserId } from "@repo/core/domain/identity/valueObject";
import type { WorkspaceId } from "@repo/core/domain/workspace/valueObject";
import { describe, expect, it } from "vitest";
import { createBlankNote } from "../../note/createBlankNote";
import { getNote } from "../../note/getNote";
import { changeMemberRole } from "../changeMemberRole";
import { listUserWorkspaces } from "../listUserWorkspaces";
import { removeMember } from "../removeMember";
import { resolveWorkspaceAccess } from "../resolveWorkspaceAccess";
import {
  createWorkspaceHarness,
  drainOutbox,
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
 * spec/testcases/workspace/removeMember.md (TC-workspace-210〜235).
 *
 * The job-termination rows (TC-workspace-217 / 219〜231) have no
 * executable form in this slice — the Job aggregate does not exist, so
 * the sweep, `Job.cancel` and the `job.terminationContinued` continuation
 * are recorded as absent rather than emitted (`membershipMutation.ts`).
 * The residue those rows describe is also what TC-workspace-218 waits for,
 * so the acknowledgement is already given here and `completeRemoval` runs
 * straight after the local commit (ADR 041 of this slice); the `removing`
 * phase is still observable, and this file pins it by failing that one
 * call.
 */

const WORKSPACE = "workspace-1";
const OTHER_WORKSPACE = "workspace-2";
const OWNER = "owner-1";
const SECOND_OWNER = "owner-2";
const EDITOR = "editor-1";
const VIEWER = "viewer-1";

const MEMBERSHIP_REMOVED = "workspace.membership.removed";

const remove = (
  h: TestHarness,
  input: Readonly<{ actorUserId: string; membershipId: string }>,
  workspaceId = WORKSPACE,
) =>
  removeMember({
    container: h.container,
    input: { workspaceId, ...input },
  });

const seed = (h: TestHarness) =>
  seedWorkspace(h, {
    workspaceId: WORKSPACE,
    members: [
      { userId: OWNER, role: "owner", membershipId: "m-owner" },
      { userId: EDITOR, role: "editor", membershipId: "m-editor" },
      { userId: VIEWER, role: "viewer", membershipId: "m-viewer" },
    ],
  });

const edgeOf = (h: TestHarness, userId: string, workspaceId = WORKSPACE) =>
  membershipEdges(h, userId).find((row) => row.workspaceId === workspaceId) ??
  null;

describe("removeMember", () => {
  it("TC-workspace-210: an owner removes an editor, emitting membership.removed and dropping the edge", async () => {
    const h = createWorkspaceHarness();
    await seed(h);

    await expect(
      remove(h, { actorUserId: OWNER, membershipId: "m-editor" }),
    ).resolves.toBeUndefined();

    expect(storedMembership(h, WORKSPACE, "m-editor")).toBeNull();
    expect(storedMemberships(h, WORKSPACE).map((m) => m.id)).toEqual([
      "m-owner",
      "m-viewer",
    ]);
    expect(outboxPayloads(h, MEMBERSHIP_REMOVED)).toEqual([
      { workspaceId: WORKSPACE, userId: EDITOR },
    ]);
    expect(edgeOf(h, EDITOR)).toBeNull();
  });

  /**
   * TC-workspace-211 names "one owner, and that owner is the target".
   * Only an owner may remove anyone, so the sole owner naming themselves
   * is refused one rule earlier as `CannotRemoveSelf`. The last-owner rule
   * itself is reachable when the count falls to one after the actor was
   * authorized — the window this test opens.
   */
  it("TC-workspace-211: an owner who became the last one before the guard ran cannot be removed", async () => {
    const h = createWorkspaceHarness();
    await seedWorkspace(h, {
      workspaceId: WORKSPACE,
      members: [
        { userId: OWNER, role: "owner", membershipId: "m-owner" },
        { userId: SECOND_OWNER, role: "owner", membershipId: "m-owner-2" },
      ],
    });

    const inner = h.container.scopeUnitOfWorkProvider;
    let interfered = false;
    const container = {
      ...h.container,
      scopeUnitOfWorkProvider: {
        run: async <T>(
          scope: Parameters<typeof inner.run<T>>[0],
          callback: Parameters<typeof inner.run<T>>[1],
        ): Promise<T> => {
          if (!interfered) {
            interfered = true;
            await changeMemberRole({
              container: h.container,
              input: {
                workspaceId: WORKSPACE,
                actorUserId: OWNER,
                membershipId: "m-owner-2",
                role: "editor",
              },
            });
          }
          return inner.run(scope, callback);
        },
      },
    };

    await expectBusinessRule(
      removeMember({
        container,
        input: {
          workspaceId: WORKSPACE,
          actorUserId: SECOND_OWNER,
          membershipId: "m-owner",
        },
      }),
      "WORKSPACE_LAST_OWNER_CANNOT_LEAVE",
    );
    expect(storedMembership(h, WORKSPACE, "m-owner")).not.toBeNull();
    // The refusal came from the guard that runs before the announcement,
    // so the last owner's workspace never left their list.
    expect(edgeOf(h, OWNER)?.edgeState).toBe("active");
  });

  it("TC-workspace-212: an owner cannot remove themselves even with a second owner present", async () => {
    const h = createWorkspaceHarness();
    await seedWorkspace(h, {
      workspaceId: WORKSPACE,
      members: [
        { userId: OWNER, role: "owner", membershipId: "m-owner" },
        { userId: SECOND_OWNER, role: "owner", membershipId: "m-owner-2" },
      ],
    });

    await expectBusinessRule(
      remove(h, { actorUserId: OWNER, membershipId: "m-owner" }),
      "WORKSPACE_CANNOT_REMOVE_SELF",
    );
    expect(storedMembership(h, WORKSPACE, "m-owner")).not.toBeNull();
    expect(edgeOf(h, OWNER)?.edgeState).toBe("active");
  });

  it("TC-workspace-213: an editor, a viewer and a non-member are all InsufficientRole", async () => {
    const h = createWorkspaceHarness();
    await seed(h);

    for (const actorUserId of [EDITOR, VIEWER, "outsider-1"]) {
      await expectBusinessRule(
        remove(h, { actorUserId, membershipId: "m-viewer" }),
        "WORKSPACE_INSUFFICIENT_ROLE",
      );
    }
    expect(storedMembership(h, WORKSPACE, "m-viewer")).not.toBeNull();
  });

  it("TC-workspace-214: a removed member can no longer open the workspace's notes", async () => {
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

    await remove(h, { actorUserId: OWNER, membershipId: "m-editor" });

    await expectNotFound(
      getNote({
        container: h.container,
        input: { noteId: note.noteId, userId: EDITOR },
      }),
      "NOTE_NOT_FOUND",
    );
  });

  it("TC-workspace-215: notes the removed member created stay with the workspace", async () => {
    const h = createWorkspaceHarness();
    await seed(h);
    const note = await createBlankNote({
      container: h.container,
      input: {
        userId: EDITOR,
        ownerType: "workspace",
        ownerWorkspaceId: WORKSPACE,
        title: "written by the editor",
      },
    });

    await remove(h, { actorUserId: OWNER, membershipId: "m-editor" });

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

  it("TC-workspace-216: a write the removed member issues afterwards is refused", async () => {
    const h = createWorkspaceHarness();
    await seed(h);

    await remove(h, { actorUserId: OWNER, membershipId: "m-editor" });

    await expectBusinessRule(
      createBlankNote({
        container: h.container,
        input: {
          userId: EDITOR,
          ownerType: "workspace",
          ownerWorkspaceId: WORKSPACE,
          title: "after removal",
        },
      }),
      "WORKSPACE_INSUFFICIENT_ROLE",
    );
  });

  it("TC-workspace-218: the edge is announced `removing` before the local delete and dropped only afterwards", async () => {
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
            `begin:${storedMembership(h, WORKSPACE, "m-editor") === null}`,
          );
        },
        completeRemoval: async (userId: UserId, workspaceId: WorkspaceId) => {
          seen.push(
            `complete:${storedMembership(h, WORKSPACE, "m-editor") === null}`,
          );
          await store.completeRemoval(userId, workspaceId);
        },
      },
    };

    await removeMember({
      container,
      input: {
        workspaceId: WORKSPACE,
        actorUserId: OWNER,
        membershipId: "m-editor",
      },
    });

    // `removing` is announced while the Membership is still there, and the
    // edge is dropped only after it is gone.
    expect(seen).toEqual(["begin:false", "complete:true"]);
    expect(edgeOf(h, EDITOR)).toBeNull();
  });

  it("TC-workspace-218: an edge whose drop failed stays `removing` and leaves the member's list at once", async () => {
    const h = createWorkspaceHarness();
    await seed(h);

    const store = h.container.membershipDirectoryReservationStore;
    const container = {
      ...h.container,
      membershipDirectoryReservationStore: {
        ...store,
        completeRemoval: async () => {
          throw new Error("residue cleanup has not acknowledged yet");
        },
      },
    };

    await removeMember({
      container,
      input: {
        workspaceId: WORKSPACE,
        actorUserId: OWNER,
        membershipId: "m-editor",
      },
    });

    expect(storedMembership(h, WORKSPACE, "m-editor")).toBeNull();
    expect(edgeOf(h, EDITOR)?.edgeState).toBe("removing");
    await expect(
      listUserWorkspaces({
        container: h.container,
        input: { userId: EDITOR },
      }),
    ).resolves.toMatchObject({ workspaces: [], hasMore: false });
  });

  it("TC-workspace-232: an unknown membership id is MEMBERSHIP_NOT_FOUND and announces nothing", async () => {
    const h = createWorkspaceHarness();
    await seed(h);

    await expectNotFound(
      remove(h, { actorUserId: OWNER, membershipId: "m-missing" }),
      "MEMBERSHIP_NOT_FOUND",
    );
    expect(membershipEdges(h).map((row) => row.edgeState)).toEqual([
      "active",
      "active",
      "active",
    ]);
  });

  it("TC-workspace-232: a membership id from another workspace is not found here", async () => {
    const h = createWorkspaceHarness();
    await seed(h);
    await seedWorkspace(h, {
      workspaceId: OTHER_WORKSPACE,
      members: [
        { userId: OWNER, role: "owner", membershipId: "m2-owner" },
        { userId: EDITOR, role: "editor", membershipId: "m2-editor" },
      ],
    });

    await expectNotFound(
      remove(h, { actorUserId: OWNER, membershipId: "m2-editor" }),
      "MEMBERSHIP_NOT_FOUND",
    );
    expect(storedMembership(h, OTHER_WORKSPACE, "m2-editor")).not.toBeNull();
  });

  it("TC-workspace-233: the removal settles in this workspace alone and leaves the member's other workspace intact", async () => {
    const h = createWorkspaceHarness();
    await seed(h);
    await seedWorkspace(h, {
      workspaceId: OTHER_WORKSPACE,
      members: [
        { userId: OWNER, role: "owner", membershipId: "m2-owner" },
        { userId: EDITOR, role: "editor", membershipId: "m2-editor" },
      ],
    });

    await remove(h, { actorUserId: OWNER, membershipId: "m-editor" });

    expect(storedMembership(h, OTHER_WORKSPACE, "m2-editor")?.role).toBe(
      "editor",
    );
    expect(edgeOf(h, EDITOR, OTHER_WORKSPACE)?.edgeState).toBe("active");
    await expect(
      resolveWorkspaceAccess({
        container: h.container,
        input: { workspaceId: OTHER_WORKSPACE, userId: EDITOR },
      }),
    ).resolves.toMatchObject({ role: "editor" });
  });

  it("TC-workspace-234: while the directory still carries the edge, the scope's own membership read refuses the member", async () => {
    const h = createWorkspaceHarness();
    await seed(h);

    const store = h.container.membershipDirectoryReservationStore;
    const container = {
      ...h.container,
      membershipDirectoryReservationStore: {
        ...store,
        beginRemoval: async () => {},
        completeRemoval: async () => {},
      },
    };

    await removeMember({
      container,
      input: {
        workspaceId: WORKSPACE,
        actorUserId: OWNER,
        membershipId: "m-editor",
      },
    });

    // The projection still lists the workspace…
    expect(edgeOf(h, EDITOR)?.edgeState).toBe("active");
    await expect(
      listUserWorkspaces({
        container: h.container,
        input: { userId: EDITOR },
      }),
    ).resolves.toMatchObject({
      workspaces: [{ workspaceId: WORKSPACE, role: "editor" }],
    });
    // …but every decision re-reads the scope, which no longer holds one.
    await expect(
      resolveWorkspaceAccess({
        container: h.container,
        input: { workspaceId: WORKSPACE, userId: EDITOR },
      }),
    ).resolves.toMatchObject({ role: null });
    await expectBusinessRule(
      createBlankNote({
        container: h.container,
        input: {
          userId: EDITOR,
          ownerType: "workspace",
          ownerWorkspaceId: WORKSPACE,
          title: "stale edge",
        },
      }),
      "WORKSPACE_INSUFFICIENT_ROLE",
    );
  });

  it("TC-workspace-235: a role change delivered after the removal does not revive the edge", async () => {
    const h = createWorkspaceHarness();
    await seed(h);

    await changeMemberRole({
      container: h.container,
      input: {
        workspaceId: WORKSPACE,
        actorUserId: OWNER,
        membershipId: "m-editor",
        role: "viewer",
      },
    });
    await remove(h, { actorUserId: OWNER, membershipId: "m-editor" });
    expect(edgeOf(h, EDITOR)).toBeNull();

    // Delivery carries no ordering guarantee: the demotion arrives after
    // the removal it preceded.
    await drainOutbox(h, {
      order: (events) =>
        [...events].sort((a, b) =>
          a.type === MEMBERSHIP_REMOVED
            ? -1
            : b.type === MEMBERSHIP_REMOVED
              ? 1
              : 0,
        ),
    });

    expect(edgeOf(h, EDITOR)).toBeNull();
    await expect(
      listUserWorkspaces({
        container: h.container,
        input: { userId: EDITOR },
      }),
    ).resolves.toMatchObject({ workspaces: [] });
  });
});
