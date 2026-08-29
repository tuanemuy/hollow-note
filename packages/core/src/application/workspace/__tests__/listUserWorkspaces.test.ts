import { UserId } from "@repo/core/domain/identity/valueObject";
import { WorkspaceId } from "@repo/core/domain/workspace/valueObject";
import { describe, expect, it } from "vitest";
import { listUserWorkspaces } from "../listUserWorkspaces";
import type { UserWorkspaceListView } from "../view";
import {
  createWorkspaceHarness,
  expectValidation,
  induceDirectoryOutage,
  recordWorkspaceDirectoryReads,
  seedWorkspace,
  type TestHarness,
  tombstoneDirectory,
  workspaceScope,
} from "./harness";

/**
 * spec/testcases/workspace/listUserWorkspaces.md (TC-workspace-190〜201).
 *
 * TC-workspace-199 (reading both routing generations during a reshard) has
 * no executable form on the reference backend: it keeps a single logical
 * generation, so there is no old/new pair to deduplicate. It is covered by
 * the `workers` project's directory conformance instead.
 */

const USER = "user-1";

const list = (
  h: TestHarness,
  input: Readonly<{ cursor?: string | null; limit?: number }> = {},
): Promise<UserWorkspaceListView> =>
  listUserWorkspaces({
    container: h.container,
    input: { userId: USER, ...input },
  });

/** Seeds one workspace the user belongs to, one clock tick after the last. */
async function join(
  h: TestHarness,
  workspaceId: string,
  role: "owner" | "editor" | "viewer" = "owner",
  options: Readonly<{ name?: string; tick?: number }> = {},
): Promise<void> {
  h.clock.advance(options.tick ?? 1000);
  await seedWorkspace(h, {
    workspaceId,
    name: options.name ?? workspaceId,
    members: [
      { userId: USER, role, membershipId: `membership-${workspaceId}` },
    ],
  });
}

describe("listUserWorkspaces", () => {
  it("TC-workspace-190: returns the three workspaces newest-first with each role", async () => {
    const h = createWorkspaceHarness();
    await join(h, "ws-a", "owner", { name: "Alpha" });
    await join(h, "ws-b", "editor", { name: "Beta" });
    await join(h, "ws-c", "viewer", { name: "Gamma" });

    const view = await list(h);

    expect(view.workspaces).toEqual([
      {
        status: "active",
        workspaceId: "ws-c",
        name: "Gamma",
        slug: null,
        avatarUrl: null,
        role: "viewer",
        publication: "private",
      },
      {
        status: "active",
        workspaceId: "ws-b",
        name: "Beta",
        slug: null,
        avatarUrl: null,
        role: "editor",
        publication: "private",
      },
      {
        status: "active",
        workspaceId: "ws-a",
        name: "Alpha",
        slug: null,
        avatarUrl: null,
        role: "owner",
        publication: "private",
      },
    ]);
    expect(view).toMatchObject({ nextCursor: null, hasMore: false });
  });

  it("TC-workspace-190: breaks a created-at tie by WorkspaceId ascending", async () => {
    const h = createWorkspaceHarness();
    // Same instant for all three: only the id decides.
    await join(h, "ws-c", "owner", { tick: 0 });
    await join(h, "ws-a", "owner", { tick: 0 });
    await join(h, "ws-b", "owner", { tick: 0 });

    const view = await list(h);

    expect(view.workspaces.map((w) => w.workspaceId)).toEqual([
      "ws-a",
      "ws-b",
      "ws-c",
    ]);
  });

  it("TC-workspace-191: a user who belongs nowhere gets an empty list", async () => {
    const h = createWorkspaceHarness();

    await expect(list(h)).resolves.toEqual({
      workspaces: [],
      nextCursor: null,
      hasMore: false,
    });
  });

  it("TC-workspace-192: a viewer membership is listed with role viewer", async () => {
    const h = createWorkspaceHarness();
    await join(h, "ws-a", "viewer");

    const view = await list(h);

    expect(view.workspaces).toHaveLength(1);
    expect(view.workspaces[0]).toMatchObject({
      workspaceId: "ws-a",
      role: "viewer",
      status: "active",
    });
  });

  it("TC-workspace-193: a workspace the user was just removed from disappears", async () => {
    const h = createWorkspaceHarness();
    await join(h, "ws-a");
    await join(h, "ws-b");

    await h.container.membershipDirectoryReservationStore.beginRemoval(
      UserId.create(USER),
      WorkspaceId.create("ws-b"),
    );

    // `removing` is already invisible: the edge is being torn down.
    expect((await list(h)).workspaces.map((w) => w.workspaceId)).toEqual([
      "ws-a",
    ]);

    await h.container.membershipDirectoryReservationStore.completeRemoval(
      UserId.create(USER),
      WorkspaceId.create("ws-b"),
    );
    expect((await list(h)).workspaces.map((w) => w.workspaceId)).toEqual([
      "ws-a",
    ]);
  });

  it("TC-workspace-194: a deleted workspace is gone once its edge is torn down", async () => {
    const h = createWorkspaceHarness();
    await join(h, "ws-a");
    await join(h, "ws-b");

    await tombstoneDirectory(h, "ws-b");
    await h.container.membershipDirectoryReservationStore.beginRemoval(
      UserId.create(USER),
      WorkspaceId.create("ws-b"),
    );
    await h.container.membershipDirectoryReservationStore.completeRemoval(
      UserId.create(USER),
      WorkspaceId.create("ws-b"),
    );

    expect((await list(h)).workspaces.map((w) => w.workspaceId)).toEqual([
      "ws-a",
    ]);
  });

  it("TC-workspace-195: caps a page at 20 and hands back an opaque cursor", async () => {
    const h = createWorkspaceHarness();
    for (let i = 0; i < 25; i += 1) {
      await join(h, `ws-${String(i).padStart(2, "0")}`);
    }

    const view = await list(h);

    expect(view.workspaces).toHaveLength(20);
    expect(view.hasMore).toBe(true);
    expect(view.nextCursor).toEqual(expect.any(String));
    // Opaque: it names neither the trailing workspace nor its key.
    expect(view.nextCursor).not.toContain("ws-05");
    expect(view.workspaces.map((w) => w.workspaceId)).toEqual(
      Array.from(
        { length: 20 },
        (_, i) => `ws-${String(24 - i).padStart(2, "0")}`,
      ),
    );
  });

  it("TC-workspace-195: refuses a limit outside 1-20 rather than clamping it", async () => {
    const h = createWorkspaceHarness();
    await join(h, "ws-a");

    await expectValidation(list(h, { limit: 21 }), "INVALID_PAGINATION");
    await expectValidation(list(h, { limit: 0 }), "INVALID_PAGINATION");
    await expectValidation(
      list(h, { cursor: "not-a-cursor" }),
      "INVALID_PAGINATION",
    );
  });

  it("TC-workspace-196: resolves a whole page's display data in one grouped batch read", async () => {
    const h = createWorkspaceHarness();
    for (let i = 0; i < 20; i += 1) {
      await join(h, `ws-${String(i).padStart(2, "0")}`);
    }
    const recorded = recordWorkspaceDirectoryReads(h);

    const view = await listUserWorkspaces({
      container: recorded.container,
      input: { userId: USER },
    });

    expect(view.workspaces).toHaveLength(20);
    expect(recorded.calls).toHaveLength(1);
    const ids = recorded.calls[0] ?? [];
    expect(ids).toHaveLength(20);
    expect(new Set(ids).size).toBe(20);
    expect([...ids].sort()).toEqual(
      view.workspaces.map((w) => w.workspaceId).sort(),
    );
  });

  it("TC-workspace-197: two pages of same-named workspaces neither skip nor repeat", async () => {
    const h = createWorkspaceHarness();
    for (let i = 0; i < 25; i += 1) {
      await join(h, `ws-${String(i).padStart(2, "0")}`, "owner", {
        name: "Same Name",
      });
    }

    const first = await list(h);
    const second = await list(h, { cursor: first.nextCursor });

    const seen = [...first.workspaces, ...second.workspaces].map(
      (w) => w.workspaceId,
    );
    expect(second.workspaces).toHaveLength(5);
    expect(second.nextCursor).toBeNull();
    expect(second.hasMore).toBe(false);
    expect(new Set(seen).size).toBe(25);
    expect([...seen].sort()).toEqual(
      Array.from({ length: 25 }, (_, i) => `ws-${String(i).padStart(2, "0")}`),
    );
  });

  it("TC-workspace-198: a rename between pages leaves the cursor and the remainder intact", async () => {
    const h = createWorkspaceHarness();
    for (let i = 0; i < 25; i += 1) {
      await join(h, `ws-${String(i).padStart(2, "0")}`);
    }

    const first = await list(h);
    // The oldest edge — the one page 2 must still return.
    const renamedId = "ws-00";
    await h.container.scopeUnitOfWorkProvider.run(
      workspaceScope(renamedId),
      async (ctx) => {
        const stored = await ctx.workspaceRepository.findById(
          WorkspaceId.create(renamedId),
        );
        if (stored === null) {
          throw new Error("seeded workspace vanished");
        }
        // Rename to a value that would sort first under any name order.
        await ctx.workspaceRepository.save(
          {
            ...stored.entity,
            name: "AAA renamed" as typeof stored.entity.name,
          },
          stored.expectedVersion,
        );
      },
    );

    const second = await list(h, { cursor: first.nextCursor });

    expect(second.workspaces.map((w) => w.workspaceId)).toEqual([
      "ws-04",
      "ws-03",
      "ws-02",
      "ws-01",
      "ws-00",
    ]);
  });

  it("TC-workspace-200: one unreadable shard degrades a single row and leaves the rest active", async () => {
    const h = createWorkspaceHarness();
    await join(h, "ws-a");
    await join(h, "ws-b", "editor");
    induceDirectoryOutage(h, "ws-b");

    const view = await list(h);

    expect(view.workspaces).toEqual([
      {
        status: "unavailable",
        workspaceId: "ws-b",
        role: "editor",
        retryAfterSeconds: null,
      },
      {
        status: "active",
        workspaceId: "ws-a",
        name: "ws-a",
        slug: null,
        avatarUrl: null,
        role: "owner",
        publication: "private",
      },
    ]);
  });

  it("TC-workspace-201: a directory tombstone drops the row, unlike an unavailable one", async () => {
    const h = createWorkspaceHarness();
    await join(h, "ws-a");
    await join(h, "ws-b");
    await join(h, "ws-c");
    await tombstoneDirectory(h, "ws-b");
    induceDirectoryOutage(h, "ws-c");

    const view = await list(h);

    expect(view.workspaces.map((w) => [w.workspaceId, w.status])).toEqual([
      ["ws-c", "unavailable"],
      ["ws-a", "active"],
    ]);
  });

  it("keeps a never-projected workspace visible as unavailable rather than dropping it", async () => {
    const h = createWorkspaceHarness();
    h.clock.advance(1000);
    await seedWorkspace(h, {
      workspaceId: "ws-a",
      members: [{ userId: USER, role: "owner" }],
      projectDirectory: false,
    });

    const view = await list(h);

    expect(view.workspaces).toEqual([
      {
        status: "unavailable",
        workspaceId: "ws-a",
        role: "owner",
        retryAfterSeconds: null,
      },
    ]);
  });
});
