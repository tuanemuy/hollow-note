import type { NoteRouteFanOutReader } from "../../../../application/ports/noteRouteFanOutReader";
import type { NoteRoute } from "../../../../application/ports/noteRouteStore";
import {
  type ScopeKey,
  ScopeKey as ScopeKeyOps,
} from "../../../../application/scope";
import type { ShardPage } from "../../../../domain/common/pagination";
import type { UserId } from "../../../../domain/identity/valueObject";
import { NoteId } from "../../../../domain/note/valueObject";
import { decodeOpaqueCursor, encodeOpaqueCursor } from "../../cursor";
import { scopeColumns, scopeFromColumns } from "../../do/scopeName";
import { enumOf, int, text, textOrNull } from "../../sql/row";
import type { SqlSession } from "../../sql/session";
import type { SqlRow, SqlValue } from "../../sql/statement";
import { GLOBAL_TABLES } from "../schema";

const TABLE = GLOBAL_TABLES.noteRoutes;

const MAX_LIMIT = 200;

const STATES = [
  "reserved",
  "active",
  "moving",
  "purging",
  "tombstone",
] as const;

const COLUMNS =
  "note_id, scope_type, scope_id, created_by, route_version, state, target_scope_type, target_scope_id, migration_id";

const toRoute = (row: SqlRow): NoteRoute => {
  const targetType = textOrNull(row, "target_scope_type");
  const targetId = textOrNull(row, "target_scope_id");
  return {
    noteId: NoteId.create(text(row, "note_id")),
    scope: scopeFromColumns(text(row, "scope_type"), text(row, "scope_id")),
    createdBy: text(row, "created_by") as UserId,
    routeVersion: int(row, "route_version"),
    state: enumOf(row, "state", STATES),
    target:
      targetType === null || targetId === null
        ? null
        : scopeFromColumns(targetType, targetId),
    migrationId: textOrNull(row, "migration_id"),
  };
};

/**
 * The secondary-key scans over `note_routes`
 * (`spec/database/index.md#note_routes` indexes).
 *
 * Both scans enumerate every route whose creation has committed — the
 * port is explicit that `moving` and `purging` belong in the result, and
 * only `reserved` is skipped, because a reserved note may never come to
 * exist. Narrowing this to `active` would silently drop notes from an
 * account-deletion manifest.
 *
 * Paging is keyset over `note_id`, never `OFFSET`, so a concurrent write
 * ahead of the cursor cannot make the walk skip a row. The cursor carries
 * the query's fingerprint, which is what turns a cursor replayed against
 * the other scan into `INVALID_PAGINATION` instead of a wrong page.
 */
export function createD1NoteRouteFanOutReader(
  deps: Readonly<{ session: SqlSession }>,
): NoteRouteFanOutReader {
  const page = async (
    fingerprint: string,
    condition: Readonly<{ sql: string; params: readonly SqlValue[] }>,
    predicate: (row: SqlRow) => boolean,
    cursor: string | null,
    limit: number,
  ): Promise<ShardPage<NoteRoute>> => {
    const after =
      cursor === null ? null : decodeOpaqueCursor(cursor, fingerprint).after;
    const effectiveLimit = Math.min(Math.max(0, limit), MAX_LIMIT);
    // One row past the page tells the walk whether a next cursor exists
    // without a second count query.
    const probe = effectiveLimit + 1;
    const keyset = after === null ? "" : " AND note_id > ?";
    const rows = await deps.session.readRows({
      table: TABLE,
      statement: {
        sql: `SELECT ${COLUMNS} FROM ${TABLE}
               WHERE ${condition.sql} AND state <> 'reserved'${keyset}
               ORDER BY note_id LIMIT ?`,
        params: [
          ...condition.params,
          ...(after === null ? [] : [after]),
          probe,
        ],
      },
      keyOf: (row) => text(row, "note_id"),
      matches: (row) =>
        predicate(row) &&
        text(row, "state") !== "reserved" &&
        (after === null || text(row, "note_id") > after),
      compare: (a, b) => (text(a, "note_id") < text(b, "note_id") ? -1 : 1),
      limit: probe,
    });
    const items = rows.slice(0, effectiveLimit);
    const last = items[items.length - 1];
    return {
      items: items.map(toRoute),
      nextCursor:
        rows.length > items.length && last !== undefined
          ? encodeOpaqueCursor({
              fp: fingerprint,
              after: text(last, "note_id"),
            })
          : null,
    };
  };

  return {
    async listByCreatedBy(
      userId: UserId,
      cursor: string | null,
      limit: number,
    ): Promise<ShardPage<NoteRoute>> {
      return page(
        `noteRouteFanOut:createdBy:${userId}`,
        { sql: "created_by = ?", params: [userId] },
        (row) => text(row, "created_by") === userId,
        cursor,
        limit,
      );
    },

    async listByScope(
      scope: ScopeKey,
      cursor: string | null,
      limit: number,
    ): Promise<ShardPage<NoteRoute>> {
      const columns = scopeColumns(scope);
      return page(
        `noteRouteFanOut:scope:${ScopeKeyOps.serialize(scope)}`,
        {
          sql: "scope_type = ? AND scope_id = ?",
          params: [columns.type, columns.id],
        },
        (row) =>
          text(row, "scope_type") === columns.type &&
          text(row, "scope_id") === columns.id,
        cursor,
        limit,
      );
    },
  };
}
