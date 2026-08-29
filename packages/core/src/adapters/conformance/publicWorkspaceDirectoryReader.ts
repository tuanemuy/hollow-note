import { beforeEach, describe, expect, it } from "vitest";
import { isSystemError } from "../../application/errors";
import {
  WorkspaceName,
  WorkspaceSlug,
} from "../../domain/workspace/valueObject";
import { expectValidation } from "./asserts";
import type { ConformanceBackend, MakeConformanceBackend } from "./backend";
import { workspaceId } from "./fixtures";

const MINUTE_MS = 60 * 1000;

/**
 * Shared conformance suite for `PublicWorkspaceDirectoryReader`
 * (ADP-workspace-007).
 */
export function describePublicWorkspaceDirectoryReaderContract(
  backendName: string,
  makeBackend: MakeConformanceBackend,
): void {
  describe(`PublicWorkspaceDirectoryReader conformance [${backendName}]`, () => {
    let backend: ConformanceBackend;
    let newest: Date;

    beforeEach(async () => {
      backend = await makeBackend();
      newest = backend.clock.now();
      // Workspaces 2 and 3 share an `updatedAt`, so only the WorkspaceId
      // tiebreak orders them; workspace 1 is newer, so a WorkspaceId-only
      // order would put it last instead of first.
      const tied = new Date(newest.getTime() - MINUTE_MS);
      await backend.seedWorkspaceDirectory([
        entry(1, "published", "active", newest),
        entry(2, "published", "active", tied),
        entry(3, "published", "active", tied),
        entry(4, "private", "active", newest),
        entry(5, "published", "deleting", newest),
      ]);
    });

    it("ADP-workspace-007: enumerates published, active workspaces in updatedAt DESC, workspaceId order", async () => {
      const page = await backend.publicWorkspaceDirectoryReader.listPublished(
        null,
        200,
      );
      expect(page.items.map((item) => item.workspaceId)).toEqual([
        workspaceId(1),
        workspaceId(2),
        workspaceId(3),
      ]);
      expect(page.items[0]).toEqual({
        workspaceId: workspaceId(1),
        slug: WorkspaceSlug.create("workspace-1"),
        updatedAt: newest,
      });
      expect(page.nextCursor).toBeNull();
    });

    it("ADP-workspace-007: resumes from the cursor until nextCursor is null", async () => {
      const first = await backend.publicWorkspaceDirectoryReader.listPublished(
        null,
        2,
      );
      expect(first.items.map((item) => item.workspaceId)).toEqual([
        workspaceId(1),
        workspaceId(2),
      ]);
      expect(first.nextCursor).not.toBeNull();

      const second = await backend.publicWorkspaceDirectoryReader.listPublished(
        first.nextCursor,
        2,
      );
      expect(second.items.map((item) => item.workspaceId)).toEqual([
        workspaceId(3),
      ]);
      expect(second.nextCursor).toBeNull();
    });

    it("ADP-workspace-007: a limit outside 1..200 raises INVALID_PAGINATION", async () => {
      await expectValidation(
        backend.publicWorkspaceDirectoryReader.listPublished(null, 0),
        "INVALID_PAGINATION",
      );
      await expectValidation(
        backend.publicWorkspaceDirectoryReader.listPublished(null, 201),
        "INVALID_PAGINATION",
      );
      expect(
        (await backend.publicWorkspaceDirectoryReader.listPublished(null, 200))
          .items,
      ).toHaveLength(3);
    });

    it("ADP-workspace-007: an unreadable cursor is rejected", async () => {
      await expectValidation(
        backend.publicWorkspaceDirectoryReader.listPublished(
          "tampered-cursor",
          2,
        ),
        "INVALID_PAGINATION",
      );
    });

    it("ADP-workspace-007: an unreadable shard fails the enumeration instead of returning a short page", async () => {
      await backend.makeWorkspaceDirectoryUnreadable([workspaceId(1)]);

      await expect(
        backend.publicWorkspaceDirectoryReader.listPublished(null, 200),
      ).rejects.toSatisfy(isSystemError);
    });
  });
}

const entry = (
  n: number,
  publication: "private" | "published",
  lifecycle: "active" | "deleting",
  updatedAt: Date,
) => ({
  workspaceId: workspaceId(n),
  name: WorkspaceName.create(`Workspace ${n}`),
  slug: WorkspaceSlug.create(`workspace-${n}`),
  avatarUrl: null,
  publication,
  lifecycle,
  sourceVersion: 1,
  updatedAt,
});
