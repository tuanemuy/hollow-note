import { describe, expect, it } from "vitest";
import { TEST_APP_URL } from "../../__tests__/helpers";
import { getWorkspacePublication } from "../getWorkspacePublication";
import {
  createWorkspaceHarness,
  expectBusinessRule,
  expectNotFound,
  removeWorkspaceRow,
  seedWorkspace,
  seedWorkspaceNotes,
  type TestHarness,
} from "./harness";

/** spec/testcases/workspace/getWorkspacePublication.md (TC-workspace-289〜297). */

const WORKSPACE = "workspace-1";
const OWNER = "owner-1";
const INSUFFICIENT_ROLE = "WORKSPACE_INSUFFICIENT_ROLE";

const read = (h: TestHarness, userId: string) =>
  getWorkspacePublication({
    container: h.container,
    input: { workspaceId: WORKSPACE, userId },
  });

const seed = (
  h: TestHarness,
  overrides: Parameters<typeof seedWorkspace>[1] = {},
) =>
  seedWorkspace(h, {
    workspaceId: WORKSPACE,
    members: [
      { userId: OWNER, role: "owner" },
      { userId: "viewer-1", role: "viewer" },
    ],
    ...overrides,
  });

describe("getWorkspacePublication", () => {
  it("TC-workspace-289: private without a slug has no slug and no public URL", async () => {
    const h = createWorkspaceHarness();
    await seed(h);

    await expect(read(h, OWNER)).resolves.toEqual({
      workspaceId: WORKSPACE,
      publication: "private",
      slug: null,
      publicUrl: null,
      publicNoteCount: 0,
      canPublish: true,
    });
  });

  it("TC-workspace-290: a private slug is reported but resolves to no page", async () => {
    const h = createWorkspaceHarness();
    await seed(h, { slug: "team-alpha" });

    await expect(read(h, OWNER)).resolves.toMatchObject({
      publication: "private",
      slug: "team-alpha",
      publicUrl: null,
    });
  });

  it("TC-workspace-291: a published workspace answers the URL built from appUrl and slug", async () => {
    const h = createWorkspaceHarness();
    await seed(h, { slug: "team-alpha", publication: "published" });

    await expect(read(h, OWNER)).resolves.toMatchObject({
      publication: "published",
      slug: "team-alpha",
      publicUrl: `${TEST_APP_URL}/w/team-alpha`,
    });
  });

  it("TC-workspace-292: counts exactly the workspace's public notes", async () => {
    const h = createWorkspaceHarness();
    await seed(h, { slug: "team-alpha", publication: "published" });
    await seedWorkspaceNotes(h, WORKSPACE, {
      publicNotes: 3,
      privateNotes: 4,
    });

    await expect(read(h, OWNER)).resolves.toMatchObject({
      publicNoteCount: 3,
    });
  });

  it("TC-workspace-293: a published workspace with nothing public reports 0", async () => {
    const h = createWorkspaceHarness();
    await seed(h, { slug: "team-alpha", publication: "published" });
    await seedWorkspaceNotes(h, WORKSPACE, { privateNotes: 5 });

    await expect(read(h, OWNER)).resolves.toMatchObject({
      publicNoteCount: 0,
    });
  });

  it("TC-workspace-294: the count is reported while still private, which is when the warning matters", async () => {
    const h = createWorkspaceHarness();
    await seed(h);
    await seedWorkspaceNotes(h, WORKSPACE, {
      publicNotes: 2,
      privateNotes: 1,
    });

    await expect(read(h, OWNER)).resolves.toMatchObject({
      publication: "private",
      publicNoteCount: 2,
    });
  });

  it("TC-workspace-292: keeps counting past the first page of the scope walk", async () => {
    const h = createWorkspaceHarness();
    await seed(h);
    await seedWorkspaceNotes(h, WORKSPACE, {
      publicNotes: 101,
      privateNotes: 30,
    });

    await expect(read(h, OWNER)).resolves.toMatchObject({
      publicNoteCount: 101,
    });
  });

  it("TC-workspace-295: a viewer reads the projection with canPublish false", async () => {
    const h = createWorkspaceHarness();
    await seed(h, { slug: "team-alpha", publication: "published" });

    await expect(read(h, "viewer-1")).resolves.toMatchObject({
      publication: "published",
      publicUrl: `${TEST_APP_URL}/w/team-alpha`,
      canPublish: false,
    });
  });

  it("TC-workspace-296: a non-member is InsufficientRole", async () => {
    const h = createWorkspaceHarness();
    await seed(h);

    await expectBusinessRule(read(h, "outsider-1"), INSUFFICIENT_ROLE);
  });

  it("TC-workspace-297: an absent or removed workspace is WORKSPACE_NOT_FOUND", async () => {
    const h = createWorkspaceHarness();
    await seed(h);

    await expectNotFound(
      getWorkspacePublication({
        container: h.container,
        input: { workspaceId: "workspace-that-never-existed", userId: OWNER },
      }),
    );

    removeWorkspaceRow(h, WORKSPACE);
    await expectNotFound(read(h, OWNER));
  });
});
