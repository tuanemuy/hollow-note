import { SystemError, SystemErrorCode } from "../../../../application/errors";
import type { ShardPage } from "../../../../domain/common/pagination";
import type {
  PublicWorkspaceDirectoryReader,
  PublicWorkspaceEntry,
} from "../../../../domain/workspace/ports/publicWorkspaceDirectoryReader";
import {
  WorkspaceId,
  WorkspaceSlug,
} from "../../../../domain/workspace/valueObject";
import { decodeOpaqueCursor, encodeOpaqueCursor } from "../../cursor";
import { throwTranslated } from "../../sql/errors";
import { date, text } from "../../sql/row";
import { type SqlRow, type SqlValue, statement } from "../../sql/statement";
import { GLOBAL_TABLES } from "../schema";
import {
  decodePosition,
  encodePosition,
  hasOutage,
  invalidPagination,
  type WorkspaceDirectoryDeps,
} from "./workspaceDirectorySupport";

const TABLE = GLOBAL_TABLES.workspaceDirectory;
const MIN_LIMIT = 1;
const MAX_LIMIT = 200;
const FINGERPRINT = "publicWorkspaceDirectory:published";

/**
 * A published row without a slug is a broken projection rather than a
 * page item, so the predicate demands one and `PublicWorkspaceEntry.slug`
 * stays non-null without a cast.
 */
const PUBLISHED =
  "publication = 'published' AND lifecycle = 'active' AND slug IS NOT NULL";

/**
 * Sitemap enumeration of `workspace_directory`
 * (`spec/database/index.md#workspace_directory`).
 *
 * The predicate is re-applied on every read whatever cursor arrives — a
 * cursor decides where a page starts, never what it may contain — and a
 * workspace whose deletion has begun leaves the enumeration immediately,
 * before its rows are gone. There is no total at any width: the caller
 * iterates `nextCursor` until it is `null`, which is the only exhaustion
 * signal. A shard that cannot be read fails the call, because the page
 * type carries no degraded variant and a truncated sitemap looks exactly
 * like a complete one.
 */
export function createD1PublicWorkspaceDirectoryReader(
  deps: WorkspaceDirectoryDeps,
): PublicWorkspaceDirectoryReader {
  return {
    async listPublished(
      cursor: string | null,
      limit: number,
    ): Promise<ShardPage<PublicWorkspaceEntry>> {
      if (!Number.isInteger(limit) || limit < MIN_LIMIT || limit > MAX_LIMIT) {
        throw invalidPagination(
          `limit must be between ${MIN_LIMIT} and ${MAX_LIMIT}`,
        );
      }
      if (hasOutage(deps)) {
        throw new SystemError(
          SystemErrorCode.DatabaseError,
          "A workspace directory shard is unreadable",
        );
      }
      const after =
        cursor === null
          ? null
          : decodePosition(decodeOpaqueCursor(cursor, FINGERPRINT).after);
      const keyset =
        after === null
          ? ""
          : " AND (updated_at < ? OR (updated_at = ? AND workspace_id > ?))";
      const bindings: readonly SqlValue[] =
        after === null ? [] : [after.at, after.at, after.id];
      // One row past the page tells the walk whether a next cursor exists
      // without a second count query.
      const probe = limit + 1;
      let rows: readonly SqlRow[];
      try {
        rows = await deps.session.query(
          statement(
            `SELECT workspace_id, slug, updated_at FROM ${TABLE}
               WHERE ${PUBLISHED}${keyset}
               ORDER BY updated_at DESC, workspace_id LIMIT ?`,
            ...bindings,
            probe,
          ),
        );
      } catch (cause) {
        throwTranslated(`${TABLE} public enumeration`, cause);
      }
      const page = rows.slice(0, limit);
      const last = page[page.length - 1];
      return {
        items: page.map((row) => ({
          workspaceId: WorkspaceId.create(text(row, "workspace_id")),
          slug: WorkspaceSlug.create(text(row, "slug")),
          updatedAt: date(row, "updated_at"),
        })),
        nextCursor:
          rows.length > page.length && last !== undefined
            ? encodeOpaqueCursor({
                fp: FINGERPRINT,
                after: encodePosition({
                  at: date(last, "updated_at").getTime(),
                  id: text(last, "workspace_id"),
                }),
              })
            : null,
      };
    },
  };
}
