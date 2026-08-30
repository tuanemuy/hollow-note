import { SystemError, SystemErrorCode } from "../../../application/errors";
import type {
  ExpectedVersion,
  Versioned,
} from "../../../domain/common/transactionalRepository";
import type {
  WorkspaceDirectoryBatchReader,
  WorkspaceDirectoryEntry,
  WorkspaceDirectoryResolution,
} from "../../../domain/workspace/ports/workspaceDirectoryBatchReader";
import type { WorkspaceId } from "../../../domain/workspace/valueObject";
import type { MemoryBackend, WorkspaceDirectoryRow } from "../store";

const MAX_BATCH = 20;

const UNAVAILABLE: WorkspaceDirectoryResolution = {
  state: "unavailable",
  retryAfterSeconds: null,
};

const toEntry = (
  row: WorkspaceDirectoryRow,
): Versioned<WorkspaceDirectoryEntry> => ({
  entity: {
    workspaceId: row.workspaceId,
    name: row.name,
    slug: row.slug,
    avatarUrl: row.avatarUrl,
    publication: row.publication,
  },
  expectedVersion:
    row.sourceVersion as number as ExpectedVersion<WorkspaceDirectoryEntry>,
});

export function createMemoryWorkspaceDirectoryBatchReader(
  backend: MemoryBackend,
): WorkspaceDirectoryBatchReader {
  return {
    async resolveMany(
      ids: readonly WorkspaceId[],
    ): Promise<ReadonlyMap<WorkspaceId, WorkspaceDirectoryResolution>> {
      if (ids.length > MAX_BATCH) {
        throw new SystemError(
          SystemErrorCode.DatabaseError,
          `resolveMany accepts at most ${MAX_BATCH} ids`,
        );
      }
      const resolved = new Map<WorkspaceId, WorkspaceDirectoryResolution>();
      for (const id of ids) {
        if (backend.workspaceDirectoryOutages.has(id)) {
          resolved.set(id, UNAVAILABLE);
          continue;
        }
        const row = backend.workspaceDirectory.get(id);
        if (row === undefined) {
          // Not projected yet — a missing key would be indistinguishable
          // from a workspace the directory knows to be gone.
          resolved.set(id, UNAVAILABLE);
          continue;
        }
        resolved.set(
          id,
          row.lifecycle === "deleting"
            ? { state: "deleted" }
            : { state: "active", entry: toEntry(row) },
        );
      }
      return resolved;
    },
  };
}
