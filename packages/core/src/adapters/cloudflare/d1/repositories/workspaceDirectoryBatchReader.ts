import { SystemError, SystemErrorCode } from "../../../../application/errors";
import type {
  ExpectedVersion,
  Versioned,
} from "../../../../domain/common/transactionalRepository";
import type {
  WorkspaceDirectoryBatchReader,
  WorkspaceDirectoryEntry,
  WorkspaceDirectoryResolution,
} from "../../../../domain/workspace/ports/workspaceDirectoryBatchReader";
import {
  WorkspaceId,
  type WorkspaceName,
  type WorkspaceSlug,
} from "../../../../domain/workspace/valueObject";
import { throwTranslated } from "../../sql/errors";
import { inJsonList, jsonList } from "../../sql/json";
import { enumOf, int, text, textOrNull } from "../../sql/row";
import { type SqlRow, statement } from "../../sql/statement";
import { GLOBAL_TABLES } from "../schema";
import {
  isUnreadable,
  projected,
  projectedOrNull,
  type WorkspaceDirectoryDeps,
} from "./workspaceDirectorySupport";

const TABLE = GLOBAL_TABLES.workspaceDirectory;
const MAX_BATCH = 20;

const SELECTION =
  "workspace_id, name, slug, avatar_url, publication, lifecycle, source_version";

const UNAVAILABLE: WorkspaceDirectoryResolution = {
  state: "unavailable",
  retryAfterSeconds: null,
};

const toEntry = (row: SqlRow): Versioned<WorkspaceDirectoryEntry> => {
  return {
    entity: {
      workspaceId: WorkspaceId.create(text(row, "workspace_id")),
      name: projected<WorkspaceName>(row, "name"),
      slug: projectedOrNull<WorkspaceSlug>(row, "slug"),
      avatarUrl: textOrNull(row, "avatar_url"),
      publication: enumOf(row, "publication", ["private", "published"]),
    },
    expectedVersion: int(
      row,
      "source_version",
    ) as ExpectedVersion<WorkspaceDirectoryEntry>,
  };
};

/**
 * Shard-spanning batch read of `workspace_directory`.
 *
 * Routing is direct from the input ids — one `json_each` expansion, never
 * a scan — and every distinct id comes back as a key whatever the read
 * found, because a caller renders one row per membership edge and has to
 * tell "this workspace is gone" from "the directory cannot answer yet".
 * A row that has not been projected resolves to `unavailable`, and so
 * does one whose shard is out of reach; only a `deleting` tombstone is
 * the durable `deleted` verdict.
 */
export function createD1WorkspaceDirectoryBatchReader(
  deps: WorkspaceDirectoryDeps,
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
      if (ids.length === 0) {
        return resolved;
      }
      const readable = [...new Set(ids)].filter(
        (id) => !isUnreadable(deps, id),
      );
      let rows: readonly SqlRow[] = [];
      if (readable.length > 0) {
        try {
          rows = await deps.session.query(
            statement(
              `SELECT ${SELECTION} FROM ${TABLE} WHERE ${inJsonList("workspace_id")}`,
              jsonList(readable),
            ),
          );
        } catch (cause) {
          throwTranslated(`${TABLE} batch read`, cause);
        }
      }
      const byId = new Map(rows.map((row) => [text(row, "workspace_id"), row]));
      for (const id of ids) {
        const row = isUnreadable(deps, id) ? undefined : byId.get(id);
        if (row === undefined) {
          resolved.set(id, UNAVAILABLE);
          continue;
        }
        resolved.set(
          id,
          text(row, "lifecycle") === "deleting"
            ? { state: "deleted" }
            : { state: "active", entry: toEntry(row) },
        );
      }
      return resolved;
    },
  };
}
