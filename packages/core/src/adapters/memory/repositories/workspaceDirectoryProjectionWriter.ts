import { ConflictError } from "../../../application/errors";
import type {
  WorkspaceDirectoryProjectionWriter,
  WorkspaceDirectorySnapshot,
} from "../../../domain/workspace/ports/workspaceDirectoryProjectionWriter";
import {
  type WorkspaceId,
  WorkspaceName,
  type WorkspaceSlug,
} from "../../../domain/workspace/valueObject";
import type { MemoryBackend, WorkspaceDirectoryRow } from "../store";

/**
 * Display name a tombstone keeps. The row survives the workspace so the
 * batch reader can answer `deleted`, and that answer carries no fields,
 * so nothing the workspace was named has to stay behind.
 */
const REDACTED_NAME = WorkspaceName.create("(deleted)");

export function createMemoryWorkspaceDirectoryProjectionWriter(
  backend: MemoryBackend,
): WorkspaceDirectoryProjectionWriter {
  const table = backend.workspaceDirectory;

  /**
   * The slug reservation store is the authority on who owns a slug, so a
   * projection row still holding one that another workspace now carries
   * is stale — it yields rather than failing the write.
   */
  const takeSlug = (slug: WorkspaceSlug, owner: WorkspaceId): void => {
    for (const row of table.values()) {
      if (row.slug === slug && row.workspaceId !== owner) {
        table.set(row.workspaceId, { ...row, slug: null });
      }
    }
  };

  return {
    async applySnapshotIfNewer(
      snapshot: WorkspaceDirectorySnapshot,
    ): Promise<void> {
      const stored = table.get(snapshot.workspaceId);
      if (
        stored !== undefined &&
        (stored.lifecycle === "deleting" ||
          stored.sourceVersion >= snapshot.sourceVersion)
      ) {
        return;
      }
      const applied: WorkspaceDirectoryRow = {
        workspaceId: snapshot.workspaceId,
        name: snapshot.name,
        slug: snapshot.slug,
        avatarUrl: snapshot.avatarUrl,
        publication: snapshot.publication,
        lifecycle: "active",
        deletionOperationId: null,
        sourceVersion: snapshot.sourceVersion,
        updatedAt: backend.clock.now(),
      };
      if (snapshot.slug !== null) {
        takeSlug(snapshot.slug, snapshot.workspaceId);
      }
      table.set(snapshot.workspaceId, applied);
    },

    async tombstone(input): Promise<void> {
      const stored = table.get(input.workspaceId);
      if (
        stored !== undefined &&
        stored.deletionOperationId !== null &&
        stored.deletionOperationId !== input.operationId
      ) {
        throw new ConflictError(
          "WORKSPACE_DIRECTORY_CONFLICT",
          `Workspace ${input.workspaceId} is already tombstoned by another deletion`,
        );
      }
      table.set(input.workspaceId, {
        workspaceId: input.workspaceId,
        name: REDACTED_NAME,
        slug: null,
        avatarUrl: null,
        publication: stored?.publication ?? "private",
        lifecycle: "deleting",
        deletionOperationId: input.operationId,
        sourceVersion: stored?.sourceVersion ?? 0,
        updatedAt: backend.clock.now(),
      });
    },
  };
}
