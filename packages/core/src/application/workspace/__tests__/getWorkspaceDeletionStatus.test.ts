import { describe, expect, it } from "vitest";
import { getWorkspaceDeletionStatus } from "../getWorkspaceDeletionStatus";
import {
  beginWorkspaceDeletion,
  createWorkspaceHarness,
  expectBusinessRule,
  removeWorkspaceRow,
  seedWorkspace,
  type TestHarness,
} from "./harness";

/**
 * spec/testcases/workspace/getWorkspaceDeletionStatus.md
 * (TC-workspace-298〜302).
 *
 * The three states are read off the Workspace row itself, so the
 * `inProgress` case is set up through the lock store `deleteWorkspace`
 * commits — the same `beginDeletion` that usecase calls — rather than by
 * driving the whole saga.
 */

const WORKSPACE = "workspace-1";
const OWNER = "owner-1";
const INSUFFICIENT_ROLE = "WORKSPACE_INSUFFICIENT_ROLE";

const read = (h: TestHarness, userId: string) =>
  getWorkspaceDeletionStatus({
    container: h.container,
    input: { workspaceId: WORKSPACE, userId },
  });

const seed = (h: TestHarness) =>
  seedWorkspace(h, {
    workspaceId: WORKSPACE,
    members: [
      { userId: OWNER, role: "owner" },
      { userId: "editor-1", role: "editor" },
      { userId: "viewer-1", role: "viewer" },
    ],
  });

describe("getWorkspaceDeletionStatus", () => {
  it("TC-workspace-298: an owner of a live workspace sees none and may delete", async () => {
    const h = createWorkspaceHarness();
    await seed(h);

    await expect(read(h, OWNER)).resolves.toEqual({
      workspaceId: WORKSPACE,
      status: "none",
      operationId: null,
      canDelete: true,
    });
  });

  it("TC-workspace-299: a viewer sees none and may not delete", async () => {
    const h = createWorkspaceHarness();
    await seed(h);

    await expect(read(h, "viewer-1")).resolves.toEqual({
      workspaceId: WORKSPACE,
      status: "none",
      operationId: null,
      canDelete: false,
    });
  });

  it("TC-workspace-299: an editor may not delete either", async () => {
    const h = createWorkspaceHarness();
    await seed(h);

    await expect(read(h, "editor-1")).resolves.toMatchObject({
      status: "none",
      canDelete: false,
    });
  });

  it("TC-workspace-300: an accepted deletion reports inProgress with its operation id", async () => {
    const h = createWorkspaceHarness();
    await seed(h);
    const operationId = await beginWorkspaceDeletion(h, WORKSPACE, "op-42");

    await expect(read(h, OWNER)).resolves.toEqual({
      workspaceId: WORKSPACE,
      status: "inProgress",
      operationId,
      canDelete: true,
    });
    await expect(read(h, "viewer-1")).resolves.toMatchObject({
      status: "inProgress",
      operationId: "op-42",
      canDelete: false,
    });
  });

  it("TC-workspace-301: once the row is gone the answer is completed, with no operation id", async () => {
    const h = createWorkspaceHarness();
    await seed(h);
    await beginWorkspaceDeletion(h, WORKSPACE, "op-42");
    removeWorkspaceRow(h, WORKSPACE);

    await expect(read(h, OWNER)).resolves.toEqual({
      workspaceId: WORKSPACE,
      status: "completed",
      operationId: null,
      canDelete: false,
    });
  });

  it("TC-workspace-301: completed is answered without a membership check, since none is left", async () => {
    const h = createWorkspaceHarness();
    await seed(h);
    removeWorkspaceRow(h, WORKSPACE);

    // A caller who never was a member reveals only that it is gone, which
    // `resolveWorkspaceAccess` already tells any signed-in caller.
    await expect(read(h, "outsider-1")).resolves.toMatchObject({
      status: "completed",
      canDelete: false,
    });
  });

  it("TC-workspace-302: a non-member of a workspace that still exists is InsufficientRole", async () => {
    const h = createWorkspaceHarness();
    await seed(h);

    await expectBusinessRule(read(h, "outsider-1"), INSUFFICIENT_ROLE);

    await beginWorkspaceDeletion(h, WORKSPACE, "op-42");
    await expectBusinessRule(read(h, "outsider-1"), INSUFFICIENT_ROLE);
  });
});
