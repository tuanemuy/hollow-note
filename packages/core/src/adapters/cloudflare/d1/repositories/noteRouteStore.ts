import {
  ConflictError,
  NotFoundError,
  SystemError,
  SystemErrorCode,
} from "../../../../application/errors";
import type { Clock } from "../../../../application/ports/clock";
import type {
  NoteRoute,
  NoteRouteStore,
} from "../../../../application/ports/noteRouteStore";
import type { UserId } from "../../../../domain/identity/valueObject";
import { NoteId } from "../../../../domain/note/valueObject";
import { scopeColumns, scopeFromColumns } from "../../do/scopeName";
import type { RowMutation } from "../../execution/writeSet";
import { opaque, remove, upsert } from "../../execution/writeSet";
import { throwTranslated } from "../../sql/errors";
import { inJsonList, jsonList } from "../../sql/json";
import { occGuard } from "../../sql/occGuard";
import {
  enumOf,
  int,
  intOrNull,
  text,
  textOrNull,
  toTimestamp,
} from "../../sql/row";
import type { SqlSession } from "../../sql/session";
import {
  type SqlRow,
  type SqlStatement,
  type SqlValue,
  statement,
} from "../../sql/statement";
import { GLOBAL_TABLES } from "../schema";

const TABLE = GLOBAL_TABLES.noteRoutes;

const MAX_RESOLVE_MANY = 500;

const STATES = [
  "reserved",
  "active",
  "moving",
  "purging",
  "tombstone",
] as const;

const COLUMNS = [
  "note_id",
  "scope_type",
  "scope_id",
  "created_by",
  "route_version",
  "state",
  "target_scope_type",
  "target_scope_id",
  "migration_id",
  "last_migration_id",
  "operation_id",
  "updated_at",
  "reservation_expires_at",
  "tombstone_expires_at",
] as const;

const SELECT_ALL = `SELECT ${COLUMNS.join(", ")} FROM ${TABLE}`;

const notFound = (noteId: string): NotFoundError =>
  new NotFoundError("NOTE_NOT_FOUND", `No route for note ${noteId}`);

const staleRoute = (noteId: string): ConflictError =>
  new ConflictError(
    "STALE_SCOPE_ROUTE",
    `Route version mismatch for note ${noteId}`,
  );

const stateViolation = (noteId: string, detail: string): ConflictError =>
  new ConflictError(
    "NOTE_ROUTE_STATE_VIOLATION",
    `Route for note ${noteId}: ${detail}`,
  );

/** Writes the whole row, so the overlay image and the statement agree. */
const writeStatement = (row: SqlRow): SqlStatement =>
  statement(
    `INSERT INTO ${TABLE} (${COLUMNS.join(", ")})
     VALUES (${COLUMNS.map(() => "?").join(", ")})
     ON CONFLICT (note_id) DO UPDATE SET ${COLUMNS.filter(
       (column) => column !== "note_id",
     )
       .map((column) => `${column} = excluded.${column}`)
       .join(", ")}`,
    ...COLUMNS.map((column): SqlValue => row[column] ?? null),
  );

/**
 * The concurrency backstop for a transition decided from a row this call
 * already read. Every branch below rejects with its own error using the
 * value it read; this guard only catches the case where another writer
 * moved the row in between, and surfaces as
 * `ConflictError("OPTIMISTIC_LOCK_FAILURE")` — a guard that fires at
 * commit cannot say which condition it stood for, so the specific codes
 * have to be decided from the staged read (`spec/database/index.md#_occ_guard`).
 */
const unchangedGuard = (row: SqlRow): SqlStatement =>
  occGuard(
    statement(
      `SELECT 1 FROM ${TABLE}
        WHERE note_id = ? AND state = ? AND route_version = ?
          AND operation_id IS ? AND migration_id IS ?`,
      text(row, "note_id"),
      text(row, "state"),
      int(row, "route_version"),
      textOrNull(row, "operation_id"),
      textOrNull(row, "migration_id"),
    ),
  );

const absentGuard = (noteId: string): SqlStatement =>
  occGuard(
    statement(
      `SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM ${TABLE} WHERE note_id = ?)`,
      noteId,
    ),
  );

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
 * Global routing rows in D1.
 *
 * The port deliberately sits outside any unit of work, so each transition
 * is decided from the row this call read and applied as one atomic write:
 * the branch that rejects uses the specific error the contract names
 * (`STALE_SCOPE_ROUTE`, state-machine `ConflictError`,
 * `NOTE_NOT_FOUND`), while an `_occ_guard` staged ahead of the write
 * turns a concurrent change into a conflict rather than a lost update.
 *
 * The stored row carries two expiries rather than one
 * (`spec/database/index.md#note_routes`): `reservation_expires_at` bounds
 * a creation in flight, `tombstone_expires_at` a completed purge. Both
 * are read-side filters — nothing sweeps them — which is why `resolve`
 * checks the clock rather than trusting the state alone.
 */
export function createD1NoteRouteStore(
  deps: Readonly<{ session: SqlSession; clock: Clock }>,
): NoteRouteStore {
  const { session } = deps;

  const contextOf = (noteId: string): string => `${TABLE} row ${noteId}`;

  const write = async (
    noteId: string,
    mutations: readonly RowMutation[],
  ): Promise<void> => {
    try {
      await session.write(mutations);
    } catch (cause) {
      throwTranslated(contextOf(noteId), cause);
    }
  };

  const readRow = async (noteId: string): Promise<SqlRow | null> => {
    try {
      return await session.readRow({
        table: TABLE,
        key: noteId,
        statement: statement(`${SELECT_ALL} WHERE note_id = ?`, noteId),
      });
    } catch (cause) {
      throwTranslated(contextOf(noteId), cause);
    }
  };

  // 500 ids over a 100-binding cap: one JSON value expanded by
  // `json_each`, never `?` per id (`../../sql/json.ts`).
  const readRows = async (
    wanted: ReadonlySet<string>,
  ): Promise<readonly SqlRow[]> => {
    try {
      return await session.readRows({
        table: TABLE,
        statement: statement(
          `${SELECT_ALL} WHERE ${inJsonList("note_id")}`,
          jsonList([...wanted]),
        ),
        keyOf: (row) => text(row, "note_id"),
        matches: (row) => wanted.has(text(row, "note_id")),
      });
    } catch (cause) {
      throwTranslated(`${TABLE} batch read`, cause);
    }
  };

  const requireRow = async (noteId: string): Promise<SqlRow> => {
    const row = await readRow(noteId);
    if (row === null) {
      throw notFound(noteId);
    }
    return row;
  };

  const isReadable = (row: SqlRow): boolean => {
    const state = text(row, "state");
    if (state === "reserved" || state === "purging") {
      return false;
    }
    const tombstoneExpiry = intOrNull(row, "tombstone_expires_at");
    return !(
      state === "tombstone" &&
      tombstoneExpiry !== null &&
      tombstoneExpiry <= deps.clock.now().getTime()
    );
  };

  const checkVersion = (row: SqlRow, expected: number): void => {
    if (int(row, "route_version") !== expected) {
      throw staleRoute(text(row, "note_id"));
    }
  };

  const commit = async (
    guard: SqlStatement,
    row: SqlRow,
  ): Promise<NoteRoute> => {
    const noteId = text(row, "note_id");
    await write(noteId, [
      opaque(guard),
      upsert({
        table: TABLE,
        key: noteId,
        row,
        statement: writeStatement(row),
      }),
    ]);
    return toRoute(row);
  };

  const nextRow = (row: SqlRow, patch: SqlRow): SqlRow => ({
    ...row,
    ...patch,
    updated_at: toTimestamp(deps.clock.now()),
  });

  return {
    async resolve(noteId): Promise<NoteRoute | null> {
      const row = await readRow(noteId);
      return row === null || !isReadable(row) ? null : toRoute(row);
    },

    async resolveMany(noteIds): Promise<ReadonlyMap<NoteId, NoteRoute>> {
      // Over the cap is a caller programming error, not a concurrent-state
      // conflict — same contract as `UserBatchReader.resolveMany`.
      if (noteIds.length > MAX_RESOLVE_MANY) {
        throw new SystemError(
          SystemErrorCode.DatabaseError,
          `resolveMany accepts at most ${MAX_RESOLVE_MANY} ids`,
        );
      }
      if (noteIds.length === 0) {
        return new Map();
      }
      const rows = await readRows(new Set<string>(noteIds));
      const result = new Map<NoteId, NoteRoute>();
      for (const row of rows) {
        if (isReadable(row)) {
          result.set(NoteId.create(text(row, "note_id")), toRoute(row));
        }
      }
      return result;
    },

    async reserveCreate(input): Promise<NoteRoute> {
      const existing = await readRow(input.noteId);
      if (existing !== null) {
        const state = text(existing, "state");
        if (
          state === "reserved" &&
          textOrNull(existing, "operation_id") === input.operationId
        ) {
          return toRoute(existing);
        }
        const expiry = intOrNull(existing, "reservation_expires_at");
        const lapsed =
          state === "reserved" &&
          expiry !== null &&
          expiry <= deps.clock.now().getTime();
        if (!lapsed) {
          throw stateViolation(
            input.noteId,
            "already routed by another operation",
          );
        }
      }
      const scope = scopeColumns(input.scope);
      const row: SqlRow = {
        note_id: input.noteId,
        scope_type: scope.type,
        scope_id: scope.id,
        created_by: input.createdBy,
        route_version: 1,
        state: "reserved",
        target_scope_type: null,
        target_scope_id: null,
        migration_id: null,
        last_migration_id: null,
        operation_id: input.operationId,
        updated_at: toTimestamp(deps.clock.now()),
        reservation_expires_at: toTimestamp(input.expiresAt),
        tombstone_expires_at: null,
      };
      return commit(
        existing === null
          ? absentGuard(input.noteId)
          : unchangedGuard(existing),
        row,
      );
    },

    async activateCreate(input): Promise<NoteRoute> {
      const row = await requireRow(input.noteId);
      if (textOrNull(row, "operation_id") !== input.operationId) {
        throw stateViolation(input.noteId, "foreign creation operation");
      }
      const state = text(row, "state");
      if (state === "active") {
        return toRoute(row);
      }
      if (state !== "reserved") {
        throw stateViolation(input.noteId, `cannot activate ${state}`);
      }
      return commit(
        unchangedGuard(row),
        nextRow(row, { state: "active", reservation_expires_at: null }),
      );
    },

    async abandonCreate(input): Promise<void> {
      const row = await readRow(input.noteId);
      if (row === null) {
        return;
      }
      if (textOrNull(row, "operation_id") !== input.operationId) {
        throw stateViolation(input.noteId, "foreign creation operation");
      }
      const state = text(row, "state");
      if (state !== "reserved") {
        throw stateViolation(input.noteId, `cannot abandon ${state}`);
      }
      await write(input.noteId, [
        opaque(unchangedGuard(row)),
        remove({
          table: TABLE,
          key: input.noteId,
          statement: statement(
            `DELETE FROM ${TABLE} WHERE note_id = ?`,
            input.noteId,
          ),
        }),
      ]);
    },

    async beginMove(input): Promise<NoteRoute> {
      const row = await requireRow(input.noteId);
      const state = text(row, "state");
      if (
        state === "moving" &&
        textOrNull(row, "migration_id") === input.migrationId
      ) {
        return toRoute(row);
      }
      if (state !== "active") {
        throw stateViolation(input.noteId, `cannot move ${state}`);
      }
      checkVersion(row, input.expectedRouteVersion);
      const target = scopeColumns(input.target);
      return commit(
        unchangedGuard(row),
        nextRow(row, {
          state: "moving",
          target_scope_type: target.type,
          target_scope_id: target.id,
          migration_id: input.migrationId,
        }),
      );
    },

    async abortMove(input): Promise<NoteRoute> {
      const row = await requireRow(input.noteId);
      if (
        text(row, "state") !== "moving" ||
        textOrNull(row, "migration_id") !== input.migrationId
      ) {
        throw stateViolation(input.noteId, "no matching move to abort");
      }
      checkVersion(row, input.expectedRouteVersion);
      return commit(
        unchangedGuard(row),
        nextRow(row, {
          state: "active",
          target_scope_type: null,
          target_scope_id: null,
          migration_id: null,
        }),
      );
    },

    async switchMove(input): Promise<NoteRoute> {
      const row = await requireRow(input.noteId);
      const state = text(row, "state");
      if (
        state === "active" &&
        int(row, "route_version") === input.expectedRouteVersion + 1 &&
        textOrNull(row, "last_migration_id") === input.migrationId
      ) {
        // Lost-response retry after a completed switch.
        return toRoute(row);
      }
      if (
        state !== "moving" ||
        textOrNull(row, "migration_id") !== input.migrationId
      ) {
        throw stateViolation(input.noteId, "no matching move to switch");
      }
      checkVersion(row, input.expectedRouteVersion);
      const targetType = textOrNull(row, "target_scope_type");
      const targetId = textOrNull(row, "target_scope_id");
      if (targetType === null || targetId === null) {
        throw stateViolation(input.noteId, "moving row without a target");
      }
      return commit(
        unchangedGuard(row),
        nextRow(row, {
          scope_type: targetType,
          scope_id: targetId,
          state: "active",
          target_scope_type: null,
          target_scope_id: null,
          migration_id: null,
          last_migration_id: input.migrationId,
          route_version: int(row, "route_version") + 1,
        }),
      );
    },

    async beginPurge(input): Promise<NoteRoute> {
      const row = await requireRow(input.noteId);
      const state = text(row, "state");
      if (
        state === "purging" &&
        textOrNull(row, "operation_id") === input.operationId
      ) {
        return toRoute(row);
      }
      if (state !== "active") {
        throw stateViolation(input.noteId, `cannot purge ${state}`);
      }
      checkVersion(row, input.expectedRouteVersion);
      return commit(
        unchangedGuard(row),
        nextRow(row, { state: "purging", operation_id: input.operationId }),
      );
    },

    async abortPurge(input): Promise<NoteRoute> {
      const row = await requireRow(input.noteId);
      if (
        text(row, "state") !== "purging" ||
        textOrNull(row, "operation_id") !== input.operationId
      ) {
        throw stateViolation(input.noteId, "no matching purge to abort");
      }
      checkVersion(row, input.expectedRouteVersion);
      return commit(unchangedGuard(row), nextRow(row, { state: "active" }));
    },

    async finishPurge(input): Promise<NoteRoute> {
      const row = await requireRow(input.noteId);
      if (textOrNull(row, "operation_id") !== input.operationId) {
        throw stateViolation(input.noteId, "foreign purge operation");
      }
      const state = text(row, "state");
      if (state === "tombstone") {
        return toRoute(row);
      }
      if (state !== "purging") {
        throw stateViolation(input.noteId, `cannot finish purge on ${state}`);
      }
      return commit(
        unchangedGuard(row),
        nextRow(row, {
          state: "tombstone",
          tombstone_expires_at: toTimestamp(input.expiresAt),
        }),
      );
    },
  };
}
