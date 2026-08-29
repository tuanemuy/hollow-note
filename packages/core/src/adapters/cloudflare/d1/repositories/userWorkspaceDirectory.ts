import type { ShardPage } from "../../../../domain/common/pagination";
import type { UserId } from "../../../../domain/identity/valueObject";
import type {
  UserWorkspaceDirectory,
  UserWorkspaceEdge,
} from "../../../../domain/workspace/ports/userWorkspaceDirectory";
import { WorkspaceId } from "../../../../domain/workspace/valueObject";
import { decodeOpaqueCursor, encodeOpaqueCursor } from "../../cursor";
import { throwTranslated } from "../../sql/errors";
import { date, enumOf, text } from "../../sql/row";
import type { SqlSession } from "../../sql/session";
import { type SqlRow, type SqlValue, statement } from "../../sql/statement";
import { GLOBAL_TABLES } from "../schema";
import {
  decodePosition,
  encodePosition,
  invalidPagination,
} from "./workspaceDirectorySupport";

const TABLE = GLOBAL_TABLES.membershipDirectory;
const MIN_LIMIT = 1;
const MAX_LIMIT = 20;

const ROLES = ["owner", "editor", "viewer"] as const;

/**
 * Keyset enumeration of the active edges of `membership_directory`
 * (`spec/database/index.md#membership_directory`), served by the
 * `(user_id, state, created_at DESC, workspace_id)` index.
 *
 * Only `active` edges surface: a `pending` edge belongs to a membership
 * whose scope-local commit has not landed, and a `removing` one is being
 * torn down while cleanup still needs it to find the scope. The order is
 * `created_at DESC, workspace_id` rather than anything name-derived,
 * because a name changes between pages and would let a row repeat or
 * vanish.
 *
 * The `user_id` predicate is re-applied on every read whatever cursor
 * arrives, and the cursor's fingerprint carries the user, so a cursor
 * minted for one user cannot open another's edges. A cursor is not a
 * capability.
 */
export function createD1UserWorkspaceDirectory(
  deps: Readonly<{ session: SqlSession }>,
): UserWorkspaceDirectory {
  return {
    async listActiveByUser(
      userId: UserId,
      cursor: string | null,
      limit: number,
    ): Promise<ShardPage<UserWorkspaceEdge>> {
      if (!Number.isInteger(limit) || limit < MIN_LIMIT || limit > MAX_LIMIT) {
        throw invalidPagination(
          `limit must be between ${MIN_LIMIT} and ${MAX_LIMIT}`,
        );
      }
      const fingerprint = `userWorkspaceDirectory:${userId}`;
      const after =
        cursor === null
          ? null
          : decodePosition(decodeOpaqueCursor(cursor, fingerprint).after);
      const keyset =
        after === null
          ? ""
          : " AND (created_at < ? OR (created_at = ? AND workspace_id > ?))";
      const bindings: readonly SqlValue[] =
        after === null ? [] : [after.at, after.at, after.id];
      const probe = limit + 1;
      let rows: readonly SqlRow[];
      try {
        rows = await deps.session.query(
          statement(
            `SELECT workspace_id, role, created_at FROM ${TABLE}
               WHERE user_id = ? AND state = 'active'${keyset}
               ORDER BY created_at DESC, workspace_id LIMIT ?`,
            userId,
            ...bindings,
            probe,
          ),
        );
      } catch (cause) {
        throwTranslated(`${TABLE} edge enumeration`, cause);
      }
      const page = rows.slice(0, limit);
      const last = page[page.length - 1];
      return {
        items: page.map((row) => ({
          workspaceId: WorkspaceId.create(text(row, "workspace_id")),
          role: enumOf(row, "role", ROLES),
        })),
        nextCursor:
          rows.length > page.length && last !== undefined
            ? encodeOpaqueCursor({
                fp: fingerprint,
                after: encodePosition({
                  at: date(last, "created_at").getTime(),
                  id: text(last, "workspace_id"),
                }),
              })
            : null,
      };
    },
  };
}
