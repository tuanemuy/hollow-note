import type { ExpectedVersion } from "@repo/core/domain/common/transactionalRepository";
import {
  WorkspaceId,
  WorkspaceSlug,
} from "@repo/core/domain/workspace/valueObject";
import type { Workspace } from "@repo/core/domain/workspace/workspace";
import { describe, expect, it } from "vitest";
import type { RequestContainer } from "../../di/types";
import { getPublicWorkspace } from "../getPublicWorkspace";
import {
  createWorkspaceHarness,
  expectNotFound,
  induceDirectoryOutage,
  removeWorkspaceRow,
  seedWorkspace,
  type TestHarness,
  tombstoneDirectory,
} from "./harness";

/** spec/testcases/workspace/getPublicWorkspace.md (TC-workspace-125〜130). */

const WORKSPACE = "workspace-1";
const SLUG = "team-alpha";

const read = (h: TestHarness, slug: string, container?: RequestContainer) =>
  getPublicWorkspace({ container: container ?? h.container, input: { slug } });

const seedPublished = (h: TestHarness) =>
  seedWorkspace(h, {
    workspaceId: WORKSPACE,
    name: "Team Alpha",
    description: "みんなの設計メモ",
    avatarUrl: "/storage/team.png",
    slug: SLUG,
    publication: "published",
    members: [{ userId: "owner-1", role: "owner" }],
  });

describe("getPublicWorkspace", () => {
  it("TC-workspace-125: a published workspace answers its name, description and icon", async () => {
    const h = createWorkspaceHarness();
    await seedPublished(h);

    await expect(read(h, SLUG)).resolves.toEqual({
      workspaceId: WORKSPACE,
      name: "Team Alpha",
      description: "みんなの設計メモ",
      avatarUrl: "/storage/team.png",
      slug: SLUG,
    });
  });

  it("TC-workspace-125: resolves an upper-case spelling of the same slug", async () => {
    const h = createWorkspaceHarness();
    await seedPublished(h);

    await expect(read(h, "Team-Alpha")).resolves.toMatchObject({
      slug: SLUG,
    });
  });

  it("TC-workspace-126: a private workspace holding the slug is WORKSPACE_NOT_FOUND", async () => {
    const h = createWorkspaceHarness();
    await seedWorkspace(h, {
      workspaceId: WORKSPACE,
      slug: SLUG,
      members: [{ userId: "owner-1", role: "owner" }],
    });

    await expectNotFound(read(h, SLUG));
  });

  it("TC-workspace-127: an unused slug is WORKSPACE_NOT_FOUND", async () => {
    const h = createWorkspaceHarness();
    await seedPublished(h);

    await expectNotFound(read(h, "nobody-holds-this"));
  });

  it("TC-workspace-127: a slug only reserved by an operation in flight is not found yet", async () => {
    const h = createWorkspaceHarness();
    await seedWorkspace(h, {
      workspaceId: WORKSPACE,
      slug: SLUG,
      publication: "published",
      members: [{ userId: "owner-1", role: "owner" }],
      reserveSlug: false,
    });
    await h.container.workspaceSlugReservationStore.reserve({
      slug: WorkspaceSlug.create(SLUG),
      workspaceId: WorkspaceId.create(WORKSPACE),
      operationId: "in-flight",
      attemptId: "in-flight",
      expiresAt: new Date(h.clock.now().getTime() + 60_000),
    });

    await expectNotFound(read(h, SLUG));
  });

  it("TC-workspace-128: a malformed or reserved slug is not found, never a validation error", async () => {
    const h = createWorkspaceHarness();
    await seedPublished(h);

    for (const slug of ["ab", "-team", "team alpha", "チーム", "settings"]) {
      await expectNotFound(read(h, slug));
    }
  });

  it("TC-workspace-129: a workspace whose deletion has begun is not found", async () => {
    const h = createWorkspaceHarness();
    await seedPublished(h);
    await tombstoneDirectory(h, WORKSPACE);

    // The directory's `deleted` verdict is durable and ends the lookup
    // even while the scope row is still there.
    await expectNotFound(read(h, SLUG));
  });

  it("TC-workspace-129: a workspace whose row the saga removed is not found", async () => {
    const h = createWorkspaceHarness();
    await seedPublished(h);
    removeWorkspaceRow(h, WORKSPACE);

    await expectNotFound(read(h, SLUG));
  });

  it("TC-workspace-130: the response carries nothing about the workspace's members", async () => {
    const h = createWorkspaceHarness();
    await seedWorkspace(h, {
      workspaceId: WORKSPACE,
      slug: SLUG,
      publication: "published",
      members: [
        { userId: "owner-1", role: "owner" },
        { userId: "editor-1", role: "editor" },
      ],
    });

    const view = await read(h, SLUG);

    expect(Object.keys(view).sort()).toEqual([
      "avatarUrl",
      "description",
      "name",
      "slug",
      "workspaceId",
    ]);
    expect(JSON.stringify(view)).not.toContain("editor-1");
  });

  it("falls back to the scope read when the directory shard cannot answer", async () => {
    const h = createWorkspaceHarness();
    await seedPublished(h);
    induceDirectoryOutage(h, WORKSPACE);

    await expect(read(h, SLUG)).resolves.toMatchObject({ slug: SLUG });
  });

  it("re-reads the scope once when the first read is older than the projection that gated it", async () => {
    const h = createWorkspaceHarness();
    const seeded = await seedPublished(h);
    // The state the scope held before it published — what a read that lost
    // the race to the projection would return.
    const stale: Workspace = {
      ...seeded.workspace,
      publication: "private",
      version: 0 as typeof seeded.workspace.version,
    };
    const container = withStaleFirstRead(h, stale);

    await expect(read(h, SLUG, container)).resolves.toMatchObject({
      workspaceId: WORKSPACE,
      slug: SLUG,
    });
  });
});

/**
 * Serves one stale snapshot from the scope reader and then delegates —
 * the window in which the directory has already moved past the scope read.
 */
function withStaleFirstRead(
  h: TestHarness,
  stale: Workspace,
): RequestContainer {
  let served = false;
  const inner = h.container.workspaceReaderFor;
  return {
    ...h.container,
    workspaceReaderFor: (scope) => {
      const reader = inner(scope);
      return {
        ...reader,
        workspace: {
          findById: async (id) => {
            if (served) {
              return reader.workspace.findById(id);
            }
            served = true;
            return {
              entity: stale,
              expectedVersion:
                stale.version as number as ExpectedVersion<Workspace>,
            };
          },
        },
      };
    },
  };
}
