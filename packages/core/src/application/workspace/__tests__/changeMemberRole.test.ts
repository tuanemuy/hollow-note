import { describe, expect, it } from "vitest";
import { createBlankNote } from "../../note/createBlankNote";
import { changeMemberRole } from "../changeMemberRole";
import {
  createWorkspaceHarness,
  expectBusinessRule,
  expectNotFound,
  outboxPayloads,
  outboxTypes,
  scheduledTasks,
  seedWorkspace,
  storedMembership,
  type TestHarness,
} from "./harness";

/**
 * spec/testcases/workspace/changeMemberRole.md (TC-workspace-021〜045).
 *
 * The job-termination rows (TC-workspace-030〜035 / 038〜044) have no
 * executable form in this slice: the Job aggregate does not exist, so the
 * sweep, `Job.cancel` and the `job.terminationContinued` continuation are
 * absent by decision rather than by omission (`membershipMutation.ts`
 * module JSDoc). What is asserted here instead, on the two rows whose
 * mutation *is* observable (TC-workspace-036 / 037), is that no
 * continuation is enqueued at all — an implementation that started
 * emitting one without a subscriber would stop the chain silently.
 *
 * TC-workspace-045 (a role change reaching the `membership_directory` out
 * of order) has no consumer either: no subscriber projects
 * `workspace.membership.roleChanged` onto the edge and the edge carries no
 * source version, so there is nothing an ordering test could discriminate.
 */

const WORKSPACE = "workspace-1";
const OTHER_WORKSPACE = "workspace-2";
const OWNER = "owner-1";
const SECOND_OWNER = "owner-2";
const EDITOR = "editor-1";
const VIEWER = "viewer-1";

const ROLE_CHANGED = "workspace.membership.roleChanged";

const change = (
  h: TestHarness,
  input: Readonly<{ actorUserId: string; membershipId: string; role: string }>,
  workspaceId = WORKSPACE,
) =>
  changeMemberRole({
    container: h.container,
    input: { workspaceId, ...input },
  });

/** owner-1 (owner), editor-1 (editor), viewer-1 (viewer). */
const seed = (h: TestHarness) =>
  seedWorkspace(h, {
    workspaceId: WORKSPACE,
    members: [
      { userId: OWNER, role: "owner", membershipId: "m-owner" },
      { userId: EDITOR, role: "editor", membershipId: "m-editor" },
      { userId: VIEWER, role: "viewer", membershipId: "m-viewer" },
    ],
  });

describe("changeMemberRole", () => {
  it("TC-workspace-021: an owner demotes an editor to viewer and emits roleChanged with the previous role", async () => {
    const h = createWorkspaceHarness();
    await seed(h);

    await expect(
      change(h, {
        actorUserId: OWNER,
        membershipId: "m-editor",
        role: "viewer",
      }),
    ).resolves.toEqual({ membershipId: "m-editor", role: "viewer" });

    expect(storedMembership(h, WORKSPACE, "m-editor")?.role).toBe("viewer");
    expect(outboxPayloads(h, ROLE_CHANGED)).toEqual([
      {
        workspaceId: WORKSPACE,
        userId: EDITOR,
        previousRole: "editor",
        currentRole: "viewer",
      },
    ]);
  });

  /**
   * TC-workspace-022 names "one owner, and that owner is the target",
   * which the request path alone cannot reach: only an owner may manage
   * members, so the sole owner targeting themselves is refused one rule
   * earlier as `CannotChangeOwnRole` (spec 手順 3 precedes 手順 4). The
   * rule the row is about is reachable when the count falls to one
   * **after** the actor was authorized — the window this test opens, by
   * demoting the other owner between `requireManageMembers` and the
   * transaction that counts.
   */
  it("TC-workspace-022: an owner who became the last one between the guard and the transaction cannot be demoted", async () => {
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
            await change(h, {
              actorUserId: OWNER,
              membershipId: "m-owner-2",
              role: "editor",
            });
          }
          return inner.run(scope, callback);
        },
      },
    };

    await expectBusinessRule(
      changeMemberRole({
        container,
        input: {
          workspaceId: WORKSPACE,
          actorUserId: SECOND_OWNER,
          membershipId: "m-owner",
          role: "editor",
        },
      }),
      "WORKSPACE_LAST_OWNER_CANNOT_LEAVE",
    );
    expect(interfered).toBe(true);
    expect(storedMembership(h, WORKSPACE, "m-owner")?.role).toBe("owner");
  });

  it("TC-workspace-023: with two owners either one may be demoted", async () => {
    const h = createWorkspaceHarness();
    await seedWorkspace(h, {
      workspaceId: WORKSPACE,
      members: [
        { userId: OWNER, role: "owner", membershipId: "m-owner" },
        { userId: SECOND_OWNER, role: "owner", membershipId: "m-owner-2" },
      ],
    });

    await expect(
      change(h, {
        actorUserId: OWNER,
        membershipId: "m-owner-2",
        role: "editor",
      }),
    ).resolves.toEqual({ membershipId: "m-owner-2", role: "editor" });
    expect(storedMembership(h, WORKSPACE, "m-owner-2")?.role).toBe("editor");
  });

  it("TC-workspace-024: a member cannot change their own role, even holding two owners", async () => {
    const h = createWorkspaceHarness();
    await seedWorkspace(h, {
      workspaceId: WORKSPACE,
      members: [
        { userId: OWNER, role: "owner", membershipId: "m-owner" },
        { userId: SECOND_OWNER, role: "owner", membershipId: "m-owner-2" },
      ],
    });

    await expectBusinessRule(
      change(h, {
        actorUserId: OWNER,
        membershipId: "m-owner",
        role: "editor",
      }),
      "WORKSPACE_CANNOT_CHANGE_OWN_ROLE",
    );
    expect(storedMembership(h, WORKSPACE, "m-owner")?.role).toBe("owner");
    expect(outboxTypes(h)).not.toContain(ROLE_CHANGED);
  });

  it("TC-workspace-025: an editor may not change anyone's role", async () => {
    const h = createWorkspaceHarness();
    await seed(h);

    await expectBusinessRule(
      change(h, {
        actorUserId: EDITOR,
        membershipId: "m-viewer",
        role: "editor",
      }),
      "WORKSPACE_INSUFFICIENT_ROLE",
    );
    expect(storedMembership(h, WORKSPACE, "m-viewer")?.role).toBe("viewer");
  });

  it("TC-workspace-025: a viewer and a non-member are refused with the same code", async () => {
    const h = createWorkspaceHarness();
    await seed(h);

    await expectBusinessRule(
      change(h, {
        actorUserId: VIEWER,
        membershipId: "m-editor",
        role: "viewer",
      }),
      "WORKSPACE_INSUFFICIENT_ROLE",
    );
    await expectBusinessRule(
      change(h, {
        actorUserId: "outsider-1",
        membershipId: "m-editor",
        role: "viewer",
      }),
      "WORKSPACE_INSUFFICIENT_ROLE",
    );
  });

  it("TC-workspace-026: a membership id belonging to another workspace is MEMBERSHIP_NOT_FOUND", async () => {
    const h = createWorkspaceHarness();
    await seed(h);
    await seedWorkspace(h, {
      workspaceId: OTHER_WORKSPACE,
      members: [
        { userId: OWNER, role: "owner", membershipId: "m2-owner" },
        { userId: "member-x", role: "editor", membershipId: "m2-editor" },
      ],
    });

    await expectNotFound(
      change(h, {
        actorUserId: OWNER,
        membershipId: "m2-editor",
        role: "viewer",
      }),
      "MEMBERSHIP_NOT_FOUND",
    );
    expect(storedMembership(h, OTHER_WORKSPACE, "m2-editor")?.role).toBe(
      "editor",
    );
  });

  it("TC-workspace-026: an id that names no membership at all is the same not-found", async () => {
    const h = createWorkspaceHarness();
    await seed(h);

    await expectNotFound(
      change(h, {
        actorUserId: OWNER,
        membershipId: "m-missing",
        role: "viewer",
      }),
      "MEMBERSHIP_NOT_FOUND",
    );
  });

  it("TC-workspace-027: an unknown role is InvalidRole and is refused before the membership is read", async () => {
    const h = createWorkspaceHarness();
    await seed(h);

    await expectBusinessRule(
      change(h, {
        actorUserId: OWNER,
        membershipId: "m-editor",
        role: "admin",
      }),
      "WORKSPACE_INVALID_ROLE",
    );
    // Naming an unknown role together with an unknown membership still
    // answers InvalidRole: the role is constructed before the lookup.
    await expectBusinessRule(
      change(h, {
        actorUserId: OWNER,
        membershipId: "m-missing",
        role: "admin",
      }),
      "WORKSPACE_INVALID_ROLE",
    );
    expect(storedMembership(h, WORKSPACE, "m-editor")?.role).toBe("editor");
  });

  it("TC-workspace-028: naming the role a member already holds writes nothing and emits nothing", async () => {
    const h = createWorkspaceHarness();
    await seed(h);
    const before = storedMembership(h, WORKSPACE, "m-editor");

    await expect(
      change(h, {
        actorUserId: OWNER,
        membershipId: "m-editor",
        role: "editor",
      }),
    ).resolves.toEqual({ membershipId: "m-editor", role: "editor" });

    const after = storedMembership(h, WORKSPACE, "m-editor");
    expect(after?.version).toBe(before?.version);
    expect(after?.updatedAt).toEqual(before?.updatedAt);
    expect(outboxTypes(h)).not.toContain(ROLE_CHANGED);
    expect(scheduledTasks(h, WORKSPACE)).toHaveLength(0);
  });

  it("TC-workspace-029: a member demoted to viewer can no longer write in the workspace", async () => {
    const h = createWorkspaceHarness();
    await seed(h);

    await expect(
      createBlankNote({
        container: h.container,
        input: {
          userId: EDITOR,
          ownerType: "workspace",
          ownerWorkspaceId: WORKSPACE,
          title: "before",
        },
      }),
    ).resolves.toMatchObject({ ownerType: "workspace" });

    await change(h, {
      actorUserId: OWNER,
      membershipId: "m-editor",
      role: "viewer",
    });

    await expectBusinessRule(
      createBlankNote({
        container: h.container,
        input: {
          userId: EDITOR,
          ownerType: "workspace",
          ownerWorkspaceId: WORKSPACE,
          title: "after",
        },
      }),
      "WORKSPACE_INSUFFICIENT_ROLE",
    );
  });

  it("TC-workspace-036: demoting an owner to editor enqueues no continuation", async () => {
    const h = createWorkspaceHarness();
    await seedWorkspace(h, {
      workspaceId: WORKSPACE,
      members: [
        { userId: OWNER, role: "owner", membershipId: "m-owner" },
        { userId: SECOND_OWNER, role: "owner", membershipId: "m-owner-2" },
      ],
    });

    await change(h, {
      actorUserId: OWNER,
      membershipId: "m-owner-2",
      role: "editor",
    });

    expect(storedMembership(h, WORKSPACE, "m-owner-2")?.role).toBe("editor");
    expect(scheduledTasks(h, WORKSPACE)).toHaveLength(0);
    expect(outboxTypes(h)).toEqual([ROLE_CHANGED]);
  });

  it("TC-workspace-037: promoting a viewer to editor enqueues no continuation", async () => {
    const h = createWorkspaceHarness();
    await seed(h);

    await change(h, {
      actorUserId: OWNER,
      membershipId: "m-viewer",
      role: "editor",
    });

    expect(storedMembership(h, WORKSPACE, "m-viewer")?.role).toBe("editor");
    expect(scheduledTasks(h, WORKSPACE)).toHaveLength(0);
    expect(outboxPayloads(h, ROLE_CHANGED)).toEqual([
      {
        workspaceId: WORKSPACE,
        userId: VIEWER,
        previousRole: "viewer",
        currentRole: "editor",
      },
    ]);
  });
});
