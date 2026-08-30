import { MembershipId } from "@repo/core/domain/workspace/valueObject";
import { describe, expect, it } from "vitest";
import { resolveWorkspaceAccess } from "../resolveWorkspaceAccess";
import {
  createWorkspaceHarness,
  expectNotFound,
  removeWorkspaceRow,
  seedWorkspace,
  type TestHarness,
  workspaceScope,
} from "./harness";

/** spec/testcases/workspace/resolveWorkspaceAccess.md (TC-workspace-245〜251). */

const WORKSPACE = "workspace-1";
const OWNER = "owner-1";
const OUTSIDER = "outsider-1";

const resolve = (h: TestHarness, userId: string, workspaceId = WORKSPACE) =>
  resolveWorkspaceAccess({
    container: h.container,
    input: { workspaceId, userId },
  });

const seed = async (h: TestHarness, role: "owner" | "editor" | "viewer") =>
  seedWorkspace(h, {
    workspaceId: WORKSPACE,
    name: "Team Alpha",
    members: [
      { userId: OWNER, role: "owner", membershipId: "membership-owner" },
      ...(role === "owner"
        ? []
        : [
            {
              userId: "member-1",
              role,
              membershipId: "membership-member",
            } as const,
          ]),
    ],
  });

describe("resolveWorkspaceAccess", () => {
  it("TC-workspace-245: an owner resolves to owner together with the workspace name", async () => {
    const h = createWorkspaceHarness();
    await seed(h, "owner");

    await expect(resolve(h, OWNER)).resolves.toEqual({
      workspaceId: WORKSPACE,
      role: "owner",
      workspaceName: "Team Alpha",
      publication: "private",
    });
  });

  it("TC-workspace-246: an editor resolves to editor", async () => {
    const h = createWorkspaceHarness();
    await seed(h, "editor");

    await expect(resolve(h, "member-1")).resolves.toMatchObject({
      role: "editor",
    });
  });

  it("TC-workspace-247: a viewer resolves to viewer", async () => {
    const h = createWorkspaceHarness();
    await seed(h, "viewer");

    await expect(resolve(h, "member-1")).resolves.toMatchObject({
      role: "viewer",
    });
  });

  it("TC-workspace-248: a non-member resolves to role null rather than an error", async () => {
    const h = createWorkspaceHarness();
    await seed(h, "owner");

    await expect(resolve(h, OUTSIDER)).resolves.toEqual({
      workspaceId: WORKSPACE,
      role: null,
      workspaceName: "Team Alpha",
      publication: "private",
    });
  });

  it("TC-workspace-249: an unknown workspace id is WORKSPACE_NOT_FOUND", async () => {
    const h = createWorkspaceHarness();
    await seed(h, "owner");

    await expectNotFound(resolve(h, OWNER, "workspace-that-never-existed"));
  });

  it("TC-workspace-250: a workspace the deletion saga removed is WORKSPACE_NOT_FOUND", async () => {
    const h = createWorkspaceHarness();
    await seed(h, "owner");
    removeWorkspaceRow(h, WORKSPACE);

    await expectNotFound(resolve(h, OWNER));
  });

  it("TC-workspace-251: a member removed a moment ago resolves to role null", async () => {
    const h = createWorkspaceHarness();
    await seed(h, "editor");
    await h.container.scopeUnitOfWorkProvider.run(
      workspaceScope(WORKSPACE),
      (ctx) =>
        ctx.membershipRepository.deleteByIds([
          MembershipId.create("membership-member"),
        ]),
    );

    await expect(resolve(h, "member-1")).resolves.toMatchObject({ role: null });
  });

  it("reads the Membership rather than the directory edge, so a stale projection cannot grant a role", async () => {
    const h = createWorkspaceHarness();
    await seed(h, "editor");
    // The global edge still says editor; the scope is the authority.
    await h.container.scopeUnitOfWorkProvider.run(
      workspaceScope(WORKSPACE),
      (ctx) =>
        ctx.membershipRepository.deleteByIds([
          MembershipId.create("membership-member"),
        ]),
    );
    expect(
      h.backend.membershipEdges
        .values()
        .filter((row) => row.userId === "member-1" && row.role === "editor"),
    ).toHaveLength(1);

    await expect(resolve(h, "member-1")).resolves.toMatchObject({ role: null });
  });
});
