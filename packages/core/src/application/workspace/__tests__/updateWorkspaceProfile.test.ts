import type { ScopeKey } from "@repo/core/application/scope";
import { describe, expect, it } from "vitest";
import type { RequestContainer } from "../../di/types";
import type { ScopeUnitOfWorkContext } from "../../execution/unitOfWork";
import { changeMemberRole } from "../changeMemberRole";
import { updateWorkspaceProfile } from "../updateWorkspaceProfile";
import {
  createWorkspaceHarness,
  directoryRow,
  expectBusinessRule,
  expectConflict,
  expectNotFound,
  outboxPayloads,
  outboxTypes,
  removeWorkspaceRow,
  seedWorkspace,
  seedWorkspaceNotes,
  storedWorkspace,
  type TestHarness,
  withFailingDirectoryProjection,
} from "./harness";

/** spec/testcases/workspace/updateWorkspaceProfile.md (TC-workspace-266〜274). */

const WORKSPACE = "workspace-1";
const OWNER = "owner-1";
const SECOND_OWNER = "owner-2";
const INSUFFICIENT_ROLE = "WORKSPACE_INSUFFICIENT_ROLE";

const update = (
  h: TestHarness,
  input: Readonly<{
    userId?: string;
    name?: string | null;
    description?: string | null;
    avatarUrl?: string | null;
  }>,
  container: RequestContainer = h.container,
) =>
  updateWorkspaceProfile({
    container,
    input: {
      workspaceId: WORKSPACE,
      userId: input.userId ?? OWNER,
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.description !== undefined
        ? { description: input.description }
        : {}),
      ...(input.avatarUrl !== undefined ? { avatarUrl: input.avatarUrl } : {}),
    },
  });

const seed = (
  h: TestHarness,
  overrides: Parameters<typeof seedWorkspace>[1] = {},
) =>
  seedWorkspace(h, {
    workspaceId: WORKSPACE,
    name: "Team Alpha",
    description: "Original description",
    members: [
      { userId: OWNER, role: "owner" },
      { userId: "editor-1", role: "editor" },
      { userId: "viewer-1", role: "viewer" },
    ],
    ...overrides,
  });

/**
 * Opens the window between the version this usecase observed and the
 * transaction it then runs, by landing a competing update right before
 * `run` delegates. Wrapping `run` itself (rather than the repository save
 * inside it) is what puts the interference *after* the observation — an
 * implementation that re-read and silently overwrote would pass if the
 * competitor landed later.
 */
const withCompetingUpdateBeforeCommit = (
  h: TestHarness,
  competitor: () => Promise<unknown>,
): RequestContainer => {
  let interfered = false;
  const inner = h.container.scopeUnitOfWorkProvider;
  return {
    ...h.container,
    scopeUnitOfWorkProvider: {
      run: async <T>(
        scope: ScopeKey,
        fn: (ctx: ScopeUnitOfWorkContext) => Promise<T>,
      ): Promise<T> => {
        if (!interfered) {
          interfered = true;
          await competitor();
        }
        return inner.run(scope, fn);
      },
    },
  };
};

describe("updateWorkspaceProfile", () => {
  it("an owner demoted after the request was authorized cannot land the write", async () => {
    const h = createWorkspaceHarness();
    await seed(h, {
      members: [
        { userId: OWNER, role: "owner", membershipId: "m-owner" },
        { userId: SECOND_OWNER, role: "owner", membershipId: "m-owner-2" },
      ],
    });

    // The role is resolved before the transaction, so the demotion lands
    // in between; only a check inside the transaction catches it.
    const container = withCompetingUpdateBeforeCommit(h, () =>
      changeMemberRole({
        container: h.container,
        input: {
          workspaceId: WORKSPACE,
          actorUserId: SECOND_OWNER,
          membershipId: "m-owner",
          role: "editor",
        },
      }),
    );

    await expectBusinessRule(
      update(h, { name: "Team Beta" }, container),
      INSUFFICIENT_ROLE,
    );
    expect(storedWorkspace(h, WORKSPACE)).toMatchObject({
      name: "Team Alpha",
      version: 0,
    });
    expect(outboxTypes(h)).toEqual(["workspace.membership.roleChanged"]);
  });

  it("TC-workspace-266: an owner updates name and description, in the scope and in the directory", async () => {
    const h = createWorkspaceHarness();
    await seed(h);

    const view = await update(h, {
      name: "Team Beta",
      description: "Renamed",
    });

    expect(view).toMatchObject({
      workspaceId: WORKSPACE,
      name: "Team Beta",
      description: "Renamed",
      publication: "private",
    });
    expect(storedWorkspace(h, WORKSPACE)).toMatchObject({
      name: "Team Beta",
      description: "Renamed",
      version: 1,
    });
    expect(directoryRow(h, WORKSPACE)).toMatchObject({
      name: "Team Beta",
      sourceVersion: 1,
    });
  });

  /**
   * The snapshot goes out after the scope commit and is retried once, so
   * a shard that stays down ends the request with the scope moved and the
   * directory a version behind. Nothing re-sends it — the projection has
   * no subscriber and no repair entry point — so that row is what every
   * list and every public read sees until the owner saves again.
   */
  it("TC-workspace-323: a projection lost for good leaves the directory a version behind, and the next save carries both changes", async () => {
    const h = createWorkspaceHarness();
    await seed(h);

    await expect(
      update(h, { name: "Team Beta" }, withFailingDirectoryProjection(h)),
    ).rejects.toThrow("directory shard unreachable");

    expect(storedWorkspace(h, WORKSPACE)).toMatchObject({
      name: "Team Beta",
      version: 1,
    });
    expect(directoryRow(h, WORKSPACE)).toMatchObject({
      name: "Team Alpha",
      sourceVersion: 0,
    });

    await expect(update(h, { description: "Renamed" })).resolves.toMatchObject({
      name: "Team Beta",
      description: "Renamed",
    });

    expect(directoryRow(h, WORKSPACE)).toMatchObject({
      name: "Team Beta",
      sourceVersion: 2,
    });
  });

  it("TC-workspace-266: an avatar URL is accepted and projected, and null clears it", async () => {
    const h = createWorkspaceHarness();
    await seed(h);

    const set = await update(h, {
      avatarUrl: `${h.config.appUrl}/files/avatar.png`,
    });
    expect(set.avatarUrl).toBe(`${h.config.appUrl}/files/avatar.png`);
    expect(directoryRow(h, WORKSPACE)?.avatarUrl).toBe(
      `${h.config.appUrl}/files/avatar.png`,
    );

    const cleared = await update(h, { avatarUrl: null });
    expect(cleared.avatarUrl).toBeNull();
    expect(directoryRow(h, WORKSPACE)?.avatarUrl).toBeNull();
  });

  it("TC-workspace-267: an editor is InsufficientRole and writes nothing", async () => {
    const h = createWorkspaceHarness();
    await seed(h);

    await expectBusinessRule(
      update(h, { userId: "editor-1", name: "Team Beta" }),
      INSUFFICIENT_ROLE,
    );

    expect(storedWorkspace(h, WORKSPACE)).toMatchObject({
      name: "Team Alpha",
      version: 0,
    });
  });

  it("TC-workspace-268: a viewer is InsufficientRole", async () => {
    const h = createWorkspaceHarness();
    await seed(h);

    await expectBusinessRule(
      update(h, { userId: "viewer-1", name: "Team Beta" }),
      INSUFFICIENT_ROLE,
    );
  });

  it("TC-workspace-269: a non-member is InsufficientRole, not NOT_FOUND", async () => {
    const h = createWorkspaceHarness();
    await seed(h);

    await expectBusinessRule(
      update(h, { userId: "outsider-1", name: "Team Beta" }),
      INSUFFICIENT_ROLE,
    );
  });

  it("TC-workspace-270: renaming a published workspace keeps it published", async () => {
    const h = createWorkspaceHarness();
    await seed(h, { slug: "team-alpha", publication: "published" });

    const view = await update(h, { name: "Team Beta" });

    expect(view).toMatchObject({
      name: "Team Beta",
      publication: "published",
      slug: "team-alpha",
    });
    expect(storedWorkspace(h, WORKSPACE)?.publication).toBe("published");
    expect(directoryRow(h, WORKSPACE)).toMatchObject({
      publication: "published",
      slug: "team-alpha",
      name: "Team Beta",
    });
  });

  it("TC-workspace-271: renaming emits workspace.profileUpdated carrying the new name", async () => {
    const h = createWorkspaceHarness();
    await seed(h);
    await seedWorkspaceNotes(h, WORKSPACE, { publicNotes: 1, privateNotes: 1 });

    await update(h, { name: "Team Beta" });

    expect(outboxTypes(h)).toEqual(["workspace.profileUpdated"]);
    expect(
      outboxPayloads<{ workspaceId: string; name: string }>(
        h,
        "workspace.profileUpdated",
      ),
    ).toEqual([{ workspaceId: WORKSPACE, name: "Team Beta" }]);
  });

  it("TC-workspace-272: a description-only edit emits nothing while still saving the description", async () => {
    const h = createWorkspaceHarness();
    await seed(h);
    await seedWorkspaceNotes(h, WORKSPACE, { publicNotes: 1 });

    const view = await update(h, {
      name: "Team Alpha",
      description: "Only the description moved",
    });

    expect(view.description).toBe("Only the description moved");
    expect(storedWorkspace(h, WORKSPACE)?.description).toBe(
      "Only the description moved",
    );
    expect(outboxTypes(h)).toEqual([]);
  });

  it("TC-workspace-272: omitting the name entirely also emits nothing", async () => {
    const h = createWorkspaceHarness();
    await seed(h);

    await update(h, { description: "Only the description moved" });

    expect(outboxTypes(h)).toEqual([]);
    expect(storedWorkspace(h, WORKSPACE)?.name).toBe("Team Alpha");
  });

  it("TC-workspace-273: an empty name is InvalidName and leaves the stored profile untouched", async () => {
    const h = createWorkspaceHarness();
    await seed(h);

    await expectBusinessRule(
      update(h, { name: "   ", description: "Renamed" }),
      "WORKSPACE_INVALID_NAME",
    );

    expect(storedWorkspace(h, WORKSPACE)).toMatchObject({
      name: "Team Alpha",
      description: "Original description",
      version: 0,
    });
    expect(directoryRow(h, WORKSPACE)?.sourceVersion).toBe(0);
  });

  it("TC-workspace-274: an update that committed in the observed window is OPTIMISTIC_LOCK_FAILURE", async () => {
    const h = createWorkspaceHarness();
    await seed(h);
    const container = withCompetingUpdateBeforeCommit(h, () =>
      update(h, { name: "Team Gamma" }),
    );

    await expectConflict(
      update(h, { name: "Team Beta" }, container),
      "OPTIMISTIC_LOCK_FAILURE",
    );

    // The competitor's write is the one that survives.
    expect(storedWorkspace(h, WORKSPACE)).toMatchObject({
      name: "Team Gamma",
      version: 1,
    });
    expect(directoryRow(h, WORKSPACE)).toMatchObject({
      name: "Team Gamma",
      sourceVersion: 1,
    });
  });

  it("a workspace the deletion saga removed is WORKSPACE_NOT_FOUND", async () => {
    const h = createWorkspaceHarness();
    await seed(h);
    removeWorkspaceRow(h, WORKSPACE);

    await expectNotFound(update(h, { name: "Team Beta" }));
  });
});
