import { describe, expect, it } from "vitest";
import { listMembers } from "../listMembers";
import type { WorkspaceMemberListView } from "../view";
import {
  createWorkspaceHarness,
  expectBusinessRule,
  expectValidation,
  type MemberSeed,
  recordUserBatchReads,
  seedWorkspace,
  type TestHarness,
} from "./harness";

/** spec/testcases/workspace/listMembers.md (TC-workspace-169〜176 / 310・311). */

const WORKSPACE = "workspace-1";
const OWNER = "owner-1";
const INSUFFICIENT_ROLE = "WORKSPACE_INSUFFICIENT_ROLE";

const list = (
  h: TestHarness,
  userId: string,
  paging: Readonly<{ page?: number; limit?: number }> = {},
): Promise<WorkspaceMemberListView> =>
  listMembers({
    container: h.container,
    input: { workspaceId: WORKSPACE, userId, ...paging },
  });

const seed = (h: TestHarness, members: readonly MemberSeed[]) =>
  seedWorkspace(h, { workspaceId: WORKSPACE, members });

describe("listMembers", () => {
  it("TC-workspace-169: an owner sees every member's display data and canManage", async () => {
    const h = createWorkspaceHarness();
    const { memberships } = await seed(h, [
      {
        userId: OWNER,
        role: "owner",
        membershipId: "m-1",
        displayName: "Owner One",
        email: "owner@example.com",
        avatarUrl: "/storage/owner.png",
      },
      {
        userId: "editor-1",
        role: "editor",
        membershipId: "m-2",
        displayName: "Editor One",
        email: "editor@example.com",
      },
      {
        userId: "viewer-1",
        role: "viewer",
        membershipId: "m-3",
        displayName: "Viewer One",
        email: "viewer@example.com",
      },
    ]);

    const view = await list(h, OWNER);

    expect(view).toEqual({
      members: [
        {
          membershipId: "m-1",
          userId: OWNER,
          displayName: "Owner One",
          email: "owner@example.com",
          avatarUrl: "/storage/owner.png",
          role: "owner",
          joinedAt: memberships[0]?.joinedAt,
        },
        {
          membershipId: "m-2",
          userId: "editor-1",
          displayName: "Editor One",
          email: "editor@example.com",
          avatarUrl: null,
          role: "editor",
          joinedAt: memberships[1]?.joinedAt,
        },
        {
          membershipId: "m-3",
          userId: "viewer-1",
          displayName: "Viewer One",
          email: "viewer@example.com",
          avatarUrl: null,
          role: "viewer",
          joinedAt: memberships[2]?.joinedAt,
        },
      ],
      count: 3,
      ownerCount: 1,
      viewerRole: "owner",
      canManage: true,
    });
  });

  it("TC-workspace-170: a viewer reads the list but cannot manage it", async () => {
    const h = createWorkspaceHarness();
    await seed(h, [
      { userId: OWNER, role: "owner", membershipId: "m-1" },
      { userId: "viewer-1", role: "viewer", membershipId: "m-2" },
    ]);

    const view = await list(h, "viewer-1");

    expect(view.members).toHaveLength(2);
    expect(view.canManage).toBe(false);
  });

  it("TC-workspace-170: an editor reads the list but still cannot manage it", async () => {
    const h = createWorkspaceHarness();
    await seed(h, [
      { userId: OWNER, role: "owner", membershipId: "m-1" },
      { userId: "editor-1", role: "editor", membershipId: "m-2" },
    ]);

    await expect(list(h, "editor-1")).resolves.toMatchObject({
      canManage: false,
    });
  });

  it("TC-workspace-171: a non-member is refused with InsufficientRole", async () => {
    const h = createWorkspaceHarness();
    await seed(h, [{ userId: OWNER, role: "owner", membershipId: "m-1" }]);

    await expectBusinessRule(list(h, "outsider-1"), INSUFFICIENT_ROLE);
  });

  it("TC-workspace-172: ownerCount counts the whole workspace, not the page", async () => {
    const h = createWorkspaceHarness();
    await seed(h, [
      { userId: OWNER, role: "owner", membershipId: "m-1" },
      { userId: "owner-2", role: "owner", membershipId: "m-2" },
      { userId: "viewer-1", role: "viewer", membershipId: "m-3" },
    ]);

    const view = await list(h, OWNER, { limit: 1 });

    expect(view.members).toHaveLength(1);
    expect(view.ownerCount).toBe(2);
  });

  it("TC-workspace-310: viewerRole answers for the reader whose own row is off the page", async () => {
    const h = createWorkspaceHarness();
    await seed(h, [
      { userId: OWNER, role: "owner", membershipId: "m-1" },
      { userId: "owner-2", role: "owner", membershipId: "m-2" },
    ]);

    const view = await list(h, "owner-2", { limit: 1 });

    expect(view.members.map((m) => m.userId)).toEqual([OWNER]);
    expect(view.viewerRole).toBe("owner");
  });

  it("TC-workspace-311: viewerRole is the reader's own role, not the first row's", async () => {
    const h = createWorkspaceHarness();
    await seed(h, [
      { userId: OWNER, role: "owner", membershipId: "m-1" },
      { userId: "viewer-1", role: "viewer", membershipId: "m-2" },
    ]);

    await expect(list(h, "viewer-1", { limit: 1 })).resolves.toMatchObject({
      viewerRole: "viewer",
    });
  });

  it("TC-workspace-173: a page over the limit returns `limit` rows and the total count", async () => {
    const h = createWorkspaceHarness();
    await seed(h, [
      { userId: OWNER, role: "owner", membershipId: "m-1" },
      { userId: "u-2", role: "viewer", membershipId: "m-2" },
      { userId: "u-3", role: "viewer", membershipId: "m-3" },
      { userId: "u-4", role: "viewer", membershipId: "m-4" },
      { userId: "u-5", role: "viewer", membershipId: "m-5" },
    ]);

    const first = await list(h, OWNER, { limit: 2 });
    const second = await list(h, OWNER, { page: 2, limit: 2 });
    const third = await list(h, OWNER, { page: 3, limit: 2 });

    expect(first.members.map((m) => m.membershipId)).toEqual(["m-1", "m-2"]);
    expect(second.members.map((m) => m.membershipId)).toEqual(["m-3", "m-4"]);
    expect(third.members.map((m) => m.membershipId)).toEqual(["m-5"]);
    expect([first.count, second.count, third.count]).toEqual([5, 5, 5]);
  });

  it("TC-workspace-174: out-of-range paging is INVALID_PAGINATION, not a clamp", async () => {
    const h = createWorkspaceHarness();
    await seed(h, [{ userId: OWNER, role: "owner", membershipId: "m-1" }]);

    await expectValidation(list(h, OWNER, { page: 0 }), "INVALID_PAGINATION");
    await expectValidation(list(h, OWNER, { limit: 0 }), "INVALID_PAGINATION");
    await expectValidation(
      list(h, OWNER, { limit: 101 }),
      "INVALID_PAGINATION",
    );
    await expectValidation(
      list(h, OWNER, { limit: 1.5 }),
      "INVALID_PAGINATION",
    );
  });

  it("TC-workspace-174: rejects paging before it reads anything", async () => {
    const h = createWorkspaceHarness();
    await seed(h, [{ userId: OWNER, role: "owner", membershipId: "m-1" }]);

    // A non-member with an invalid page still gets the pagination verdict:
    // the shape check runs ahead of the authorization read.
    await expectValidation(
      list(h, "outsider-1", { page: 0 }),
      "INVALID_PAGINATION",
    );
  });

  it("TC-workspace-175: a member whose account is gone still renders, with no display fields", async () => {
    const h = createWorkspaceHarness();
    await seed(h, [
      { userId: OWNER, role: "owner", membershipId: "m-1" },
      {
        userId: "gone-1",
        role: "editor",
        membershipId: "m-2",
        displayName: "Gone",
        user: "deleted",
      },
      { userId: "absent-1", role: "viewer", membershipId: "m-3", user: "none" },
    ]);

    const view = await list(h, OWNER);

    expect(
      view.members.map((m) => [m.membershipId, m.displayName, m.email]),
    ).toEqual([
      ["m-1", OWNER, `${OWNER}@example.com`],
      ["m-2", null, null],
      ["m-3", null, null],
    ]);
    expect(view.members[1]).toMatchObject({
      userId: "gone-1",
      role: "editor",
      avatarUrl: null,
    });
  });

  it("TC-workspace-176: a full page resolves its display data in one grouped, bounded read", async () => {
    const h = createWorkspaceHarness();
    const members: MemberSeed[] = [
      { userId: OWNER, role: "owner", membershipId: "m-000" },
    ];
    for (let i = 1; i < 100; i += 1) {
      members.push({
        userId: `member-${String(i).padStart(3, "0")}`,
        role: "viewer",
        membershipId: `m-${String(i).padStart(3, "0")}`,
      });
    }
    await seed(h, members);
    const recorded = recordUserBatchReads(h);

    const view = await listMembers({
      container: recorded.container,
      input: { workspaceId: WORKSPACE, userId: OWNER, limit: 100 },
    });

    expect(view.members).toHaveLength(100);
    expect(view.count).toBe(100);
    expect(recorded.calls).toHaveLength(1);
    const ids = recorded.calls[0] ?? [];
    // Grouped by UserId and within the batch reader's 100-id cap.
    expect(ids).toHaveLength(100);
    expect(new Set(ids).size).toBe(100);
    expect(view.members.every((m) => m.displayName !== null)).toBe(true);
  });
});
