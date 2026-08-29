import { beforeEach, describe, expect, it } from "vitest";
import type { WorkspaceDirectorySnapshot } from "../../domain/workspace/ports/workspaceDirectoryProjectionWriter";
import {
  WorkspaceName,
  WorkspaceSlug,
} from "../../domain/workspace/valueObject";
import { expectConflict } from "./asserts";
import type { ConformanceBackend, MakeConformanceBackend } from "./backend";
import { workspaceId } from "./fixtures";

const MINUTE_MS = 60 * 1000;

/**
 * Shared conformance suite for `WorkspaceDirectoryProjectionWriter`
 * (ADP-workspace-066..067).
 *
 * Every assertion reads back through the three directory readers rather
 * than through a private hook: what the projection is for is what those
 * readers show, and a writer that stored something they cannot see would
 * be indistinguishable from one that stored nothing.
 */
export function describeWorkspaceDirectoryProjectionWriterContract(
  backendName: string,
  makeBackend: MakeConformanceBackend,
): void {
  describe(`WorkspaceDirectoryProjectionWriter conformance [${backendName}]`, () => {
    let backend: ConformanceBackend;
    const writer = () => backend.workspaceDirectoryProjectionWriter;

    beforeEach(async () => {
      backend = await makeBackend();
    });

    const snapshot = (
      n: number,
      sourceVersion: number,
      overrides: Partial<WorkspaceDirectorySnapshot> = {},
    ): WorkspaceDirectorySnapshot => ({
      workspaceId: workspaceId(n),
      name: WorkspaceName.create(`Workspace ${n}`),
      slug: WorkspaceSlug.create(`workspace-${n}`),
      avatarUrl: `/files/avatar-${n}`,
      publication: "private",
      sourceVersion,
      ...overrides,
    });

    const resolve = async (n: number) =>
      (
        await backend.workspaceDirectoryBatchReader.resolveMany([
          workspaceId(n),
        ])
      ).get(workspaceId(n));

    /** The row's projected slug, or `"notActive"` when it is not one. */
    const slugOf = async (n: number): Promise<string | null> => {
      const resolved = await resolve(n);
      return resolved?.state === "active"
        ? resolved.entry.entity.slug
        : "notActive";
    };

    const published = async (): Promise<readonly string[]> => {
      const page = await backend.publicWorkspaceDirectoryReader.listPublished(
        null,
        200,
      );
      return page.items.map((item) => item.workspaceId);
    };

    it("ADP-workspace-066: a first snapshot becomes the row the batch reader resolves", async () => {
      expect(await resolve(1)).toEqual({
        state: "unavailable",
        retryAfterSeconds: null,
      });

      await writer().applySnapshotIfNewer(snapshot(1, 1));
      expect(await resolve(1)).toEqual({
        state: "active",
        entry: {
          entity: {
            workspaceId: workspaceId(1),
            name: WorkspaceName.create("Workspace 1"),
            slug: WorkspaceSlug.create("workspace-1"),
            avatarUrl: "/files/avatar-1",
            publication: "private",
          },
          expectedVersion: 1,
        },
      });
    });

    it("ADP-workspace-066: a higher version replaces the row and a lower or equal one is ignored", async () => {
      await writer().applySnapshotIfNewer(snapshot(1, 2));

      await writer().applySnapshotIfNewer(
        snapshot(1, 5, { name: WorkspaceName.create("Renamed") }),
      );
      // A redelivery of the same event writes nothing...
      await writer().applySnapshotIfNewer(
        snapshot(1, 5, { name: WorkspaceName.create("Redelivered") }),
      );
      // ...and neither does an older one that arrives after it.
      await writer().applySnapshotIfNewer(
        snapshot(1, 3, { name: WorkspaceName.create("Stale") }),
      );

      const resolved = await resolve(1);
      expect(resolved).toEqual({
        state: "active",
        entry: {
          entity: {
            workspaceId: workspaceId(1),
            name: WorkspaceName.create("Renamed"),
            slug: WorkspaceSlug.create("workspace-1"),
            avatarUrl: "/files/avatar-1",
            publication: "private",
          },
          expectedVersion: 5,
        },
      });
    });

    it("ADP-workspace-066: publication moves the row in and out of the public enumeration", async () => {
      await writer().applySnapshotIfNewer(snapshot(1, 1));
      expect(await published()).toEqual([]);

      await writer().applySnapshotIfNewer(
        snapshot(1, 2, { publication: "published" }),
      );
      expect(await published()).toEqual([workspaceId(1)]);

      await writer().applySnapshotIfNewer(
        snapshot(1, 3, { publication: "private" }),
      );
      expect(await published()).toEqual([]);
    });

    it("ADP-workspace-066: a snapshot takes its slug from whichever row still projects it", async () => {
      await writer().applySnapshotIfNewer(
        snapshot(1, 1, { slug: WorkspaceSlug.create("shared-slug") }),
      );
      // The reservation store is the authority on who owns a slug, so the
      // older projection yields instead of failing the write.
      await writer().applySnapshotIfNewer(
        snapshot(2, 1, { slug: WorkspaceSlug.create("shared-slug") }),
      );

      expect(await slugOf(1)).toBeNull();
      expect(await slugOf(2)).toBe(WorkspaceSlug.create("shared-slug"));
    });

    it("ADP-workspace-066: a snapshot that writes nothing takes no slug away", async () => {
      await writer().applySnapshotIfNewer(
        snapshot(1, 5, { slug: WorkspaceSlug.create("alpha") }),
      );
      await writer().applySnapshotIfNewer(
        snapshot(2, 1, {
          slug: WorkspaceSlug.create("shared-slug"),
          publication: "published",
        }),
      );

      // Stale by `sourceVersion`, so it neither lands nor strips the
      // slug the snapshot names off the row that now holds it.
      await writer().applySnapshotIfNewer(
        snapshot(1, 2, { slug: WorkspaceSlug.create("shared-slug") }),
      );

      expect(await slugOf(1)).toBe(WorkspaceSlug.create("alpha"));
      expect(await slugOf(2)).toBe(WorkspaceSlug.create("shared-slug"));
      expect(await published()).toEqual([workspaceId(2)]);

      // Same for a snapshot against a tombstone.
      await writer().tombstone({
        workspaceId: workspaceId(3),
        operationId: "deletion-3",
      });
      await writer().applySnapshotIfNewer(
        snapshot(3, 9, { slug: WorkspaceSlug.create("shared-slug") }),
      );
      expect(await slugOf(2)).toBe(WorkspaceSlug.create("shared-slug"));
      expect(await published()).toEqual([workspaceId(2)]);
    });

    it("ADP-workspace-067: a tombstone answers deleted, leaves the sitemap, and frees its slug", async () => {
      await writer().applySnapshotIfNewer(
        snapshot(1, 1, { publication: "published" }),
      );
      expect(await published()).toEqual([workspaceId(1)]);

      await writer().tombstone({
        workspaceId: workspaceId(1),
        operationId: "deletion-1",
      });

      expect(await resolve(1)).toEqual({ state: "deleted" });
      expect(await published()).toEqual([]);
      // The slug is released with the row, so a new workspace may take it.
      await writer().applySnapshotIfNewer(
        snapshot(2, 1, { slug: WorkspaceSlug.create("workspace-1") }),
      );
      expect(await slugOf(2)).toBe(WorkspaceSlug.create("workspace-1"));
    });

    it("ADP-workspace-067: a tombstone is idempotent for its deletion and refuses a foreign one", async () => {
      await writer().applySnapshotIfNewer(snapshot(1, 1));

      await writer().tombstone({
        workspaceId: workspaceId(1),
        operationId: "deletion-1",
      });
      // The lost-response retry converges on the same row.
      await writer().tombstone({
        workspaceId: workspaceId(1),
        operationId: "deletion-1",
      });
      await expectConflict(
        writer().tombstone({
          workspaceId: workspaceId(1),
          operationId: "deletion-2",
        }),
      );
      expect(await resolve(1)).toEqual({ state: "deleted" });
    });

    it("ADP-workspace-066/067: no snapshot reopens a tombstone at any version", async () => {
      await writer().applySnapshotIfNewer(snapshot(1, 1));
      await writer().tombstone({
        workspaceId: workspaceId(1),
        operationId: "deletion-1",
      });

      await writer().applySnapshotIfNewer(
        snapshot(1, 99, { publication: "published" }),
      );
      expect(await resolve(1)).toEqual({ state: "deleted" });
      expect(await published()).toEqual([]);
    });

    it("ADP-workspace-067: a workspace that was never projected still tombstones", async () => {
      await writer().tombstone({
        workspaceId: workspaceId(9),
        operationId: "deletion-9",
      });
      expect(await resolve(9)).toEqual({ state: "deleted" });
    });

    it("ADP-workspace-066: the sitemap orders by the apply instant, not by the source version", async () => {
      await writer().applySnapshotIfNewer(
        snapshot(1, 7, { publication: "published" }),
      );
      backend.clock.advance(MINUTE_MS);
      await writer().applySnapshotIfNewer(
        snapshot(2, 1, { publication: "published" }),
      );

      expect(await published()).toEqual([workspaceId(2), workspaceId(1)]);
    });
  });
}
