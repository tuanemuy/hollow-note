import { beforeEach, describe, expect, it } from "vitest";
import { isSystemError } from "../../application/errors";
import {
  WorkspaceName,
  WorkspaceSlug,
} from "../../domain/workspace/valueObject";
import type { ConformanceBackend, MakeConformanceBackend } from "./backend";
import { workspaceId } from "./fixtures";

/**
 * Shared conformance suite for `WorkspaceDirectoryBatchReader`
 * (ADP-workspace-006).
 */
export function describeWorkspaceDirectoryBatchReaderContract(
  backendName: string,
  makeBackend: MakeConformanceBackend,
): void {
  describe(`WorkspaceDirectoryBatchReader conformance [${backendName}]`, () => {
    let backend: ConformanceBackend;

    beforeEach(async () => {
      backend = await makeBackend();
      const now = backend.clock.now();
      await backend.seedWorkspaceDirectory([
        {
          workspaceId: workspaceId(1),
          name: WorkspaceName.create("Workspace 1"),
          slug: WorkspaceSlug.create("workspace-1"),
          avatarUrl: "/files/avatar-1",
          publication: "published",
          lifecycle: "active",
          sourceVersion: 7,
          updatedAt: now,
        },
        {
          workspaceId: workspaceId(2),
          name: WorkspaceName.create("Workspace 2"),
          slug: null,
          avatarUrl: null,
          publication: "private",
          lifecycle: "active",
          sourceVersion: 3,
          updatedAt: now,
        },
        {
          workspaceId: workspaceId(3),
          name: WorkspaceName.create("Deleted workspace"),
          slug: null,
          avatarUrl: null,
          publication: "private",
          lifecycle: "deleting",
          sourceVersion: 9,
          updatedAt: now,
        },
      ]);
    });

    it("ADP-workspace-006: every distinct input id appears exactly once, carrying the projection's source version", async () => {
      const resolved = await backend.workspaceDirectoryBatchReader.resolveMany([
        workspaceId(1),
        workspaceId(2),
        workspaceId(3),
        workspaceId(4),
      ]);

      expect(resolved.size).toBe(4);
      expect(resolved.get(workspaceId(1))).toEqual({
        state: "active",
        entry: {
          entity: {
            workspaceId: workspaceId(1),
            name: WorkspaceName.create("Workspace 1"),
            slug: WorkspaceSlug.create("workspace-1"),
            avatarUrl: "/files/avatar-1",
            publication: "published",
          },
          expectedVersion: 7,
        },
      });
      expect(resolved.get(workspaceId(2))).toEqual({
        state: "active",
        entry: {
          entity: {
            workspaceId: workspaceId(2),
            name: WorkspaceName.create("Workspace 2"),
            slug: null,
            avatarUrl: null,
            publication: "private",
          },
          expectedVersion: 3,
        },
      });
      // A durable verdict the caller acts on by dropping the row...
      expect(resolved.get(workspaceId(3))).toEqual({ state: "deleted" });
      // ...against "not right now", which keeps the row in a degraded
      // form. A row that has not been projected yet is the latter, and it
      // is a present key rather than a missing one.
      expect(resolved.has(workspaceId(4))).toBe(true);
      expect(resolved.get(workspaceId(4))).toEqual({
        state: "unavailable",
        retryAfterSeconds: null,
      });
    });

    it("ADP-workspace-006: duplicate ids collapse into one entry and an empty input resolves to an empty map", async () => {
      const resolved = await backend.workspaceDirectoryBatchReader.resolveMany([
        workspaceId(1),
        workspaceId(1),
      ]);
      expect(resolved.size).toBe(1);
      expect(resolved.get(workspaceId(1))?.state).toBe("active");

      expect(
        (await backend.workspaceDirectoryBatchReader.resolveMany([])).size,
      ).toBe(0);
    });

    it("ADP-workspace-006: an unreadable shard degrades its own ids only", async () => {
      await backend.makeWorkspaceDirectoryUnreadable([workspaceId(1)]);

      const resolved = await backend.workspaceDirectoryBatchReader.resolveMany([
        workspaceId(1),
        workspaceId(2),
        workspaceId(3),
      ]);
      expect(resolved.get(workspaceId(1))).toEqual({
        state: "unavailable",
        retryAfterSeconds: null,
      });
      expect(resolved.get(workspaceId(2))?.state).toBe("active");
      expect(resolved.get(workspaceId(3))?.state).toBe("deleted");
    });

    it("ADP-workspace-006: resolveMany accepts exactly 20 ids and rejects 21", async () => {
      const atLimit = await backend.workspaceDirectoryBatchReader.resolveMany(
        Array.from({ length: 20 }, (_, i) => workspaceId(i + 1)),
      );
      expect(atLimit.size).toBe(20);
      expect(atLimit.get(workspaceId(1))?.state).toBe("active");

      await expect(
        backend.workspaceDirectoryBatchReader.resolveMany(
          Array.from({ length: 21 }, (_, i) => workspaceId(i + 1)),
        ),
      ).rejects.toSatisfy(isSystemError);
    });
  });
}
