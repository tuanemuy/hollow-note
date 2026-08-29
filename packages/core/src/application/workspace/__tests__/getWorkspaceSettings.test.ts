import { describe, expect, it } from "vitest";
import { getWorkspaceSettings } from "../getWorkspaceSettings";
import {
  createWorkspaceHarness,
  expectBusinessRule,
  expectNotFound,
  removeWorkspaceRow,
  seedWorkspace,
  type TestHarness,
} from "./harness";

/** spec/testcases/workspace/getWorkspaceSettings.md (TC-workspace-275〜280). */

const WORKSPACE = "workspace-1";
const OWNER = "owner-1";
const INSUFFICIENT_ROLE = "WORKSPACE_INSUFFICIENT_ROLE";

const read = (h: TestHarness, userId: string) =>
  getWorkspaceSettings({
    container: h.container,
    input: { workspaceId: WORKSPACE, userId },
  });

const seed = (
  h: TestHarness,
  overrides: Parameters<typeof seedWorkspace>[1] = {},
) =>
  seedWorkspace(h, {
    workspaceId: WORKSPACE,
    name: "Team Alpha",
    members: [
      { userId: OWNER, role: "owner" },
      { userId: "editor-1", role: "editor" },
      { userId: "viewer-1", role: "viewer" },
    ],
    ...overrides,
  });

describe("getWorkspaceSettings", () => {
  it("TC-workspace-275: an owner reads every editable field with all three capabilities", async () => {
    const h = createWorkspaceHarness();
    await seed(h, { description: "設計メモ", slug: "team-alpha" });

    await expect(read(h, OWNER)).resolves.toEqual({
      workspaceId: WORKSPACE,
      name: "Team Alpha",
      description: "設計メモ",
      avatarUrl: null,
      slug: "team-alpha",
      publication: "private",
      role: "owner",
      canManage: true,
      canPublish: true,
      canDelete: true,
    });
  });

  it("TC-workspace-276: a viewer reads the same projection with every capability false", async () => {
    const h = createWorkspaceHarness();
    await seed(h, { description: "設計メモ", slug: "team-alpha" });

    await expect(read(h, "viewer-1")).resolves.toEqual({
      workspaceId: WORKSPACE,
      name: "Team Alpha",
      description: "設計メモ",
      avatarUrl: null,
      slug: "team-alpha",
      publication: "private",
      role: "viewer",
      canManage: false,
      canPublish: false,
      canDelete: false,
    });
  });

  it("TC-workspace-276: an editor is read-only here too", async () => {
    const h = createWorkspaceHarness();
    await seed(h);

    await expect(read(h, "editor-1")).resolves.toMatchObject({
      role: "editor",
      canManage: false,
      canPublish: false,
      canDelete: false,
    });
  });

  it("TC-workspace-277: description and icon come back as stored, not blanked", async () => {
    const h = createWorkspaceHarness();
    await seed(h, {
      description: "  余白ごと保つ説明  ",
      avatarUrl: "/storage/team.png",
      slug: "team-alpha",
      publication: "published",
    });

    await expect(read(h, OWNER)).resolves.toMatchObject({
      description: "  余白ごと保つ説明  ",
      avatarUrl: "/storage/team.png",
      publication: "published",
    });
  });

  it("TC-workspace-278: a workspace with no slug reads slug: null", async () => {
    const h = createWorkspaceHarness();
    await seed(h, { slug: null });

    await expect(read(h, OWNER)).resolves.toMatchObject({ slug: null });
  });

  it("TC-workspace-279: a non-member is InsufficientRole, not a not-found", async () => {
    const h = createWorkspaceHarness();
    await seed(h);

    await expectBusinessRule(read(h, "outsider-1"), INSUFFICIENT_ROLE);
  });

  it("TC-workspace-280: an absent workspace is WORKSPACE_NOT_FOUND", async () => {
    const h = createWorkspaceHarness();
    await seed(h);

    await expectNotFound(
      getWorkspaceSettings({
        container: h.container,
        input: { workspaceId: "workspace-that-never-existed", userId: OWNER },
      }),
    );
  });

  it("TC-workspace-280: a workspace the deletion saga removed is WORKSPACE_NOT_FOUND", async () => {
    const h = createWorkspaceHarness();
    await seed(h);
    removeWorkspaceRow(h, WORKSPACE);

    await expectNotFound(read(h, OWNER));
  });
});
