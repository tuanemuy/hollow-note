import { UserId } from "@repo/core/domain/identity/valueObject";
import {
  MembershipId,
  WorkspaceId,
} from "@repo/core/domain/workspace/valueObject";
import { describe, expect, it } from "vitest";
import type { RequestContainer } from "../../di/types";
import { isConflictError } from "../../errors";
import { createWorkspace } from "../createWorkspace";
import {
  createWorkspaceHarness,
  directoryRow,
  expectBusinessRule,
  expectConflict,
  membershipEdges,
  outboxTypes,
  seedUser,
  seedWorkspace,
  slugReservations,
  storedMemberships,
  storedWorkspace,
  type TestHarness,
  workspaceScope,
} from "./harness";

/** spec/testcases/workspace/createWorkspace.md (TC-workspace-055〜068). */

const OWNER = "owner-1";
const RESERVATION_TTL_MS = 10 * 60 * 1000;

const create = (
  h: TestHarness,
  input: Readonly<{
    userId?: string;
    name?: string;
    description?: string | null;
    slug?: string | null;
  }> = {},
  container: RequestContainer = h.container,
) =>
  createWorkspace({
    container,
    input: {
      userId: input.userId ?? OWNER,
      name: input.name ?? "Team Alpha",
      ...(input.description !== undefined
        ? { description: input.description }
        : {}),
      ...(input.slug !== undefined ? { slug: input.slug } : {}),
    },
  });

/**
 * Owner edges of the global `membership_directory`, which is what the
 * quota counts. Seeded through the reservation store rather than through
 * whole workspaces: `countOwnedByUser` reads nothing else, and `settle`
 * is the difference the quota is meant to see — an `activating` edge is a
 * creation still in flight and must occupy a seat all the same.
 */
async function seedOwnerEdges(
  h: TestHarness,
  userId: string,
  count: number,
  settle: "active" | "inFlight" = "active",
): Promise<void> {
  const store = h.container.membershipDirectoryReservationStore;
  const expiresAt = new Date(h.clock.now().getTime() + RESERVATION_TTL_MS);
  for (let i = 0; i < count; i += 1) {
    const operationId = `owned-op-${userId}-${settle}-${i}`;
    await store.reserveAndClaimActivation({
      operationId,
      userId: UserId.create(userId),
      workspaceId: WorkspaceId.create(`owned-workspace-${settle}-${i}`),
      membershipId: MembershipId.create(`owned-membership-${settle}-${i}`),
      role: "owner",
      expiresAt,
    });
    if (settle === "active") {
      await store.activate(operationId);
    }
  }
}

/** A container whose scope commit never lands. */
const withFailingScopeCommit = (
  h: TestHarness,
  error: Error,
): RequestContainer => ({
  ...h.container,
  scopeUnitOfWorkProvider: {
    run: () => Promise.reject(error),
  },
});

describe("createWorkspace", () => {
  it("TC-workspace-055: a first workspace is private with the creator as owner, across scope and global plane", async () => {
    const h = createWorkspaceHarness();
    seedUser(h, { userId: OWNER });

    const view = await create(h, { name: "Team Alpha", slug: "team-alpha" });

    expect(view).toEqual({
      workspaceId: view.workspaceId,
      name: "Team Alpha",
      slug: "team-alpha",
      publication: "private",
      role: "owner",
    });
    expect(storedWorkspace(h, view.workspaceId)).toMatchObject({
      name: "Team Alpha",
      slug: "team-alpha",
      publication: "private",
      lifecycle: { state: "active" },
      version: 0,
    });
    expect(
      storedMemberships(h, view.workspaceId).map((membership) => ({
        userId: membership.userId,
        role: membership.role,
      })),
    ).toEqual([{ userId: OWNER, role: "owner" }]);
    expect(slugReservations(h)).toEqual([
      expect.objectContaining({
        slug: "team-alpha",
        workspaceId: view.workspaceId,
        state: "active",
        expiresAt: null,
      }),
    ]);
    expect(
      membershipEdges(h, OWNER).map((edge) => ({
        workspaceId: edge.workspaceId,
        role: edge.role,
        edgeState: edge.edgeState,
      })),
    ).toEqual([
      { workspaceId: view.workspaceId, role: "owner", edgeState: "active" },
    ]);
    expect(directoryRow(h, view.workspaceId)).toMatchObject({
      name: "Team Alpha",
      slug: "team-alpha",
      publication: "private",
      lifecycle: "active",
      sourceVersion: 0,
    });
    expect(outboxTypes(h)).toEqual([
      "workspace.created",
      "workspace.membership.added",
    ]);
  });

  it("TC-workspace-056: omitting the slug creates the workspace with no slug and no reservation", async () => {
    const h = createWorkspaceHarness();
    seedUser(h, { userId: OWNER });

    const view = await create(h, { slug: null });

    expect(view.slug).toBeNull();
    expect(storedWorkspace(h, view.workspaceId)?.slug).toBeNull();
    expect(slugReservations(h)).toEqual([]);
    expect(directoryRow(h, view.workspaceId)).toMatchObject({ slug: null });
  });

  it("TC-workspace-057: a slug another workspace holds is SLUG_ALREADY_USED and leaves no saga state", async () => {
    const h = createWorkspaceHarness();
    await seedWorkspace(h, {
      workspaceId: "workspace-taken",
      slug: "team-alpha",
      members: [{ userId: "other-owner", role: "owner" }],
    });
    seedUser(h, { userId: OWNER });

    await expectConflict(
      create(h, { slug: "team-alpha" }),
      "SLUG_ALREADY_USED",
    );

    // The reservation still belongs to the incumbent, and the loser left
    // neither an edge nor a directory row behind.
    expect(slugReservations(h)).toEqual([
      expect.objectContaining({
        slug: "team-alpha",
        workspaceId: "workspace-taken",
        state: "active",
      }),
    ]);
    expect(membershipEdges(h, OWNER)).toEqual([]);
    expect(h.backend.workspaceDirectory.values()).toHaveLength(1);
  });

  it("TC-workspace-058: a reserved word is SlugReserved before any reservation exists", async () => {
    const h = createWorkspaceHarness();
    seedUser(h, { userId: OWNER });

    await expectBusinessRule(
      create(h, { slug: "new" }),
      "WORKSPACE_SLUG_RESERVED",
    );

    expect(slugReservations(h)).toEqual([]);
    expect(membershipEdges(h, OWNER)).toEqual([]);
  });

  it("TC-workspace-059: a two-character slug is InvalidSlug", async () => {
    const h = createWorkspaceHarness();
    seedUser(h, { userId: OWNER });

    await expectBusinessRule(
      create(h, { slug: "ab" }),
      "WORKSPACE_INVALID_SLUG",
    );
    // The shortest accepted slug is one character longer.
    await expect(create(h, { slug: "abc" })).resolves.toMatchObject({
      slug: "abc",
    });
  });

  it("TC-workspace-060: an empty name is InvalidName and leaves no saga state", async () => {
    const h = createWorkspaceHarness();
    seedUser(h, { userId: OWNER });

    await expectBusinessRule(
      create(h, { name: "   ", slug: "team-alpha" }),
      "WORKSPACE_INVALID_NAME",
    );

    expect(slugReservations(h)).toEqual([]);
    expect(membershipEdges(h, OWNER)).toEqual([]);
  });

  it("TC-workspace-061: 81 characters is InvalidName while 80 is accepted", async () => {
    const h = createWorkspaceHarness();
    seedUser(h, { userId: OWNER });

    await expectBusinessRule(
      create(h, { name: "a".repeat(81) }),
      "WORKSPACE_INVALID_NAME",
    );
    await expect(create(h, { name: "a".repeat(80) })).resolves.toMatchObject({
      name: "a".repeat(80),
    });
  });

  it("TC-workspace-062: the 20th workspace of an owner with 19 succeeds", async () => {
    const h = createWorkspaceHarness();
    seedUser(h, { userId: OWNER });
    await seedOwnerEdges(h, OWNER, 19);

    const view = await create(h, { slug: "team-20" });

    expect(view.role).toBe("owner");
    expect(membershipEdges(h, OWNER)).toHaveLength(20);
  });

  it("TC-workspace-063: an owner already holding 20 is WorkspaceQuotaExceeded", async () => {
    const h = createWorkspaceHarness();
    seedUser(h, { userId: OWNER });
    await seedOwnerEdges(h, OWNER, 20);

    await expectBusinessRule(
      create(h, { slug: "team-21" }),
      "WORKSPACE_QUOTA_EXCEEDED",
    );

    // Rejected before the saga opens: nothing global was touched.
    expect(membershipEdges(h, OWNER)).toHaveLength(20);
    expect(slugReservations(h)).toEqual([]);
  });

  it("TC-workspace-063: non-owner edges do not consume the quota", async () => {
    const h = createWorkspaceHarness();
    seedUser(h, { userId: OWNER });
    await seedOwnerEdges(h, OWNER, 19);
    const store = h.container.membershipDirectoryReservationStore;
    await store.reserveAndClaimActivation({
      operationId: "editor-edge",
      userId: UserId.create(OWNER),
      workspaceId: WorkspaceId.create("someone-elses-workspace"),
      membershipId: MembershipId.create("editor-membership"),
      role: "editor",
      expiresAt: new Date(h.clock.now().getTime() + RESERVATION_TTL_MS),
    });
    await store.activate("editor-edge");

    await expect(create(h, { slug: "team-20" })).resolves.toMatchObject({
      role: "owner",
    });
  });

  it("TC-workspace-068: 19 settled owner edges plus one still activating already fills the quota", async () => {
    const h = createWorkspaceHarness();
    seedUser(h, { userId: OWNER });
    await seedOwnerEdges(h, OWNER, 19);
    await seedOwnerEdges(h, OWNER, 1, "inFlight");
    expect(
      membershipEdges(h, OWNER).filter(
        (edge) => edge.edgeState === "activating",
      ),
    ).toHaveLength(1);

    await expectBusinessRule(
      create(h, { slug: "team-21" }),
      "WORKSPACE_QUOTA_EXCEEDED",
    );
  });

  it("TC-workspace-064: a freshly created workspace is private in the view, the scope and the directory", async () => {
    const h = createWorkspaceHarness();
    seedUser(h, { userId: OWNER });

    const view = await create(h, { slug: "team-alpha" });

    expect(view.publication).toBe("private");
    expect(storedWorkspace(h, view.workspaceId)?.publication).toBe("private");
    expect(directoryRow(h, view.workspaceId)?.publication).toBe("private");
  });

  it("TC-workspace-065: two concurrent creates of one slug leave exactly one winner", async () => {
    const h = createWorkspaceHarness();
    seedUser(h, { userId: OWNER });
    seedUser(h, { userId: "owner-2" });

    const results = await Promise.allSettled([
      create(h, { userId: OWNER, slug: "team-alpha" }),
      create(h, { userId: "owner-2", slug: "team-alpha" }),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(
      rejected.every(
        (r) =>
          isConflictError(r.reason) && r.reason.code === "SLUG_ALREADY_USED",
      ),
    ).toBe(true);

    const winner = fulfilled[0];
    if (winner?.status !== "fulfilled") {
      throw new Error("expected one fulfilled create");
    }
    expect(slugReservations(h)).toEqual([
      expect.objectContaining({
        slug: "team-alpha",
        workspaceId: winner.value.workspaceId,
        state: "active",
      }),
    ]);
    expect(h.backend.workspaceDirectory.values()).toHaveLength(1);
  });

  it("TC-workspace-066: a scope commit that never lands frees both global reservations and publishes no directory row", async () => {
    const h = createWorkspaceHarness();
    seedUser(h, { userId: OWNER });
    const commitFailure = new Error("scope commit lost");

    await expect(
      create(
        h,
        { slug: "team-alpha" },
        withFailingScopeCommit(h, commitFailure),
      ),
    ).rejects.toBe(commitFailure);

    expect(slugReservations(h)).toEqual([]);
    expect(membershipEdges(h, OWNER)).toEqual([]);
    expect(h.backend.workspaceDirectory.values()).toEqual([]);
    // The freed slug is immediately usable by the retry.
    await expect(create(h, { slug: "team-alpha" })).resolves.toMatchObject({
      slug: "team-alpha",
    });
  });

  it("TC-workspace-066: a directory edge that cannot be reserved frees the slug it already took", async () => {
    const h = createWorkspaceHarness();
    // No identity row, so `reserveAndClaimActivation` refuses the edge.

    await expect(create(h, { slug: "team-alpha" })).rejects.toBeInstanceOf(
      Error,
    );

    expect(slugReservations(h)).toEqual([]);
    expect(h.backend.workspaceDirectory.values()).toEqual([]);
  });

  it("TC-workspace-067: a lost activation response is recovered under the same operation id without a second workspace", async () => {
    const h = createWorkspaceHarness();
    seedUser(h, { userId: OWNER });

    const slugCalls: string[] = [];
    const edgeCalls: string[] = [];
    let directoryCalls = 0;
    const inner = h.container;
    const container: RequestContainer = {
      ...inner,
      workspaceSlugReservationStore: {
        ...inner.workspaceSlugReservationStore,
        activate: async (activateInput) => {
          slugCalls.push(activateInput.operationId);
          if (slugCalls.length === 1) {
            throw new Error("slug activate response lost");
          }
          await inner.workspaceSlugReservationStore.activate(activateInput);
        },
      },
      membershipDirectoryReservationStore: {
        ...inner.membershipDirectoryReservationStore,
        activate: async (operationId) => {
          edgeCalls.push(operationId);
          if (edgeCalls.length === 1) {
            throw new Error("edge activate response lost");
          }
          await inner.membershipDirectoryReservationStore.activate(operationId);
        },
      },
      workspaceDirectoryProjectionWriter: {
        ...inner.workspaceDirectoryProjectionWriter,
        applySnapshotIfNewer: async (snapshot) => {
          directoryCalls += 1;
          if (directoryCalls === 1) {
            throw new Error("directory projection response lost");
          }
          return inner.workspaceDirectoryProjectionWriter.applySnapshotIfNewer(
            snapshot,
          );
        },
      },
    };

    const view = await create(h, { slug: "team-alpha" }, container);

    // Each retry re-issued the *same* operation id; a fresh one would have
    // collided with the workspace's own reserved row.
    expect(slugCalls).toHaveLength(2);
    expect(slugCalls[1]).toBe(slugCalls[0]);
    expect(edgeCalls).toHaveLength(2);
    expect(edgeCalls[1]).toBe(edgeCalls[0]);
    expect(directoryCalls).toBe(2);

    expect(
      h.backend.scope(workspaceScope(view.workspaceId)).workspaces.values(),
    ).toHaveLength(1);
    expect(slugReservations(h)).toEqual([
      expect.objectContaining({ state: "active", operationId: slugCalls[0] }),
    ]);
    expect(membershipEdges(h, OWNER)).toEqual([
      expect.objectContaining({ edgeState: "active", edgeKey: edgeCalls[0] }),
    ]);
    expect(directoryRow(h, view.workspaceId)).toMatchObject({
      slug: "team-alpha",
      lifecycle: "active",
    });
    expect(outboxTypes(h)).toEqual([
      "workspace.created",
      "workspace.membership.added",
    ]);
  });
});
