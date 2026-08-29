import { isSystemError } from "@repo/core/application/errors";
import { describe, expect, it } from "vitest";
import { listPublicWorkspaces } from "../listPublicWorkspaces";
import type { PublicWorkspaceListView } from "../view";
import {
  createWorkspaceHarness,
  expectValidation,
  induceDirectoryOutage,
  seedWorkspace,
  type TestHarness,
  tombstoneDirectory,
} from "./harness";

/**
 * spec/testcases/workspace/listPublicWorkspaces.md (TC-workspace-183〜189).
 *
 * TC-workspace-189 (deduplicating one workspace across two routing
 * generations) has no executable form on the reference backend: it keeps a
 * single logical generation, so a WorkspaceId can only hold one row.
 */

const enumerate = (
  h: TestHarness,
  input: Readonly<{ cursor?: string | null; limit?: number }> = {},
): Promise<PublicWorkspaceListView> =>
  listPublicWorkspaces({ container: h.container, input });

/** Publishes one workspace, one clock tick after the last. */
async function publish(
  h: TestHarness,
  workspaceId: string,
  slug: string,
): Promise<void> {
  h.clock.advance(1000);
  await seedWorkspace(h, {
    workspaceId,
    slug,
    publication: "published",
    members: [{ userId: `owner-of-${workspaceId}`, role: "owner" }],
  });
}

describe("listPublicWorkspaces", () => {
  it("TC-workspace-183: answers each published workspace's slug and updatedAt", async () => {
    const h = createWorkspaceHarness();
    await publish(h, "ws-a", "alpha");
    const secondAt = h.clock.now();
    await publish(h, "ws-b", "beta");
    await publish(h, "ws-c", "gamma");

    const view = await enumerate(h);

    expect(view.entries.map((entry) => entry.slug)).toEqual([
      "gamma",
      "beta",
      "alpha",
    ]);
    expect(view.entries[1]?.updatedAt).toEqual(
      new Date(secondAt.getTime() + 1000),
    );
    expect(view).toMatchObject({ nextCursor: null, hasMore: false });
  });

  it("TC-workspace-184: a private workspace is not enumerated, even holding a slug", async () => {
    const h = createWorkspaceHarness();
    await publish(h, "ws-a", "alpha");
    h.clock.advance(1000);
    await seedWorkspace(h, {
      workspaceId: "ws-private",
      slug: "hidden",
      members: [{ userId: "owner-2", role: "owner" }],
    });

    const view = await enumerate(h);

    expect(view.entries.map((entry) => entry.slug)).toEqual(["alpha"]);
  });

  it("TC-workspace-185: a workspace whose deletion has begun leaves the enumeration", async () => {
    const h = createWorkspaceHarness();
    await publish(h, "ws-a", "alpha");
    await publish(h, "ws-b", "beta");
    await tombstoneDirectory(h, "ws-b");

    const view = await enumerate(h);

    expect(view.entries.map((entry) => entry.slug)).toEqual(["alpha"]);
  });

  it("TC-workspace-186: no published workspace yields an empty exhausted page", async () => {
    const h = createWorkspaceHarness();
    h.clock.advance(1000);
    await seedWorkspace(h, {
      workspaceId: "ws-private",
      members: [{ userId: "owner-1", role: "owner" }],
    });

    await expect(enumerate(h)).resolves.toEqual({
      entries: [],
      nextCursor: null,
      hasMore: false,
    });
  });

  it("TC-workspace-187: a page over the limit stops at `limit` and carries an opaque cursor, with no total", async () => {
    const h = createWorkspaceHarness();
    for (let i = 0; i < 5; i += 1) {
      await publish(h, `ws-${i}`, `slug-${i}`);
    }

    const view = await enumerate(h, { limit: 2 });

    expect(view.entries.map((entry) => entry.slug)).toEqual([
      "slug-4",
      "slug-3",
    ]);
    expect(view.hasMore).toBe(true);
    expect(view.nextCursor).toEqual(expect.any(String));
    expect(view.nextCursor).not.toContain("ws-3");
    expect(Object.keys(view).sort()).toEqual([
      "entries",
      "hasMore",
      "nextCursor",
    ]);
  });

  it("TC-workspace-188: merges the whole service into pages of at most 200 and refuses more", async () => {
    const h = createWorkspaceHarness();
    for (let i = 0; i < 7; i += 1) {
      await publish(h, `ws-${i}`, `slug-${i}`);
    }

    await expectValidation(enumerate(h, { limit: 201 }), "INVALID_PAGINATION");
    await expectValidation(enumerate(h, { limit: 0 }), "INVALID_PAGINATION");
    await expect(enumerate(h, { limit: 200 })).resolves.toMatchObject({
      hasMore: false,
    });

    // The generator's own loop: iterate nextCursor until it is null.
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 10; page += 1) {
      const view: PublicWorkspaceListView = await enumerate(h, {
        cursor,
        limit: 3,
      });
      seen.push(...view.entries.map((entry) => entry.slug));
      cursor = view.nextCursor;
      if (cursor === null) {
        break;
      }
    }
    expect(cursor).toBeNull();
    expect(seen).toEqual([
      "slug-6",
      "slug-5",
      "slug-4",
      "slug-3",
      "slug-2",
      "slug-1",
      "slug-0",
    ]);
    expect(new Set(seen).size).toBe(7);
  });

  it("fails the whole enumeration when a shard cannot be read, rather than returning a short page", async () => {
    const h = createWorkspaceHarness();
    await publish(h, "ws-a", "alpha");
    await publish(h, "ws-b", "beta");
    induceDirectoryOutage(h, "ws-b");

    await expect(enumerate(h)).rejects.toSatisfy(isSystemError);
  });

  it("rejects a tampered cursor instead of restarting the enumeration", async () => {
    const h = createWorkspaceHarness();
    await publish(h, "ws-a", "alpha");

    await expectValidation(
      enumerate(h, { cursor: "not-a-cursor" }),
      "INVALID_PAGINATION",
    );
  });
});
