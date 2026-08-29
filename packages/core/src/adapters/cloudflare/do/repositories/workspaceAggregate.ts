import { SystemError, SystemErrorCode } from "../../../../application/errors";
import type {
  ExpectedVersion,
  TransactionalRepository,
  Versioned,
} from "../../../../domain/common/transactionalRepository";
import {
  opaque,
  type RowMutation,
  remove,
  upsert,
} from "../../execution/writeSet";
import { optimisticLockFailure, throwTranslated } from "../../sql/errors";
import { deleteRowsFromJson, inJsonList, jsonList } from "../../sql/json";
import { occGuard } from "../../sql/occGuard";
import { int, text } from "../../sql/row";
import type { SqlSession } from "../../sql/session";
import {
  type SqlRow,
  type SqlStatement,
  type SqlValue,
  statement,
} from "../../sql/statement";

/**
 * The three Workspace aggregates of a scope object — `workspaces`,
 * `memberships`, `invitations` — differ only in their columns and their
 * rehydration, so the OCC mechanics they share live here once.
 *
 * The mechanics are the same as `noteRepository`'s: a read-before-write
 * turns a stale token into `ConflictError("OPTIMISTIC_LOCK_FAILURE")`
 * while the write is still only staged, and an `occGuard` staged ahead of
 * the statement is the fence against a unit that commits in between.
 *
 * Scope binding is not re-checked here. A workspace scope object holds
 * exactly its own workspace and that workspace's children, so a foreign
 * id simply matches no row — none of these tables is a scope key in the
 * sense `spec/database/index.md` の「共通の規約」 gives the term, which is
 * why the check `noteRepository` performs on `owner_type` / `owner_id` has
 * no counterpart here.
 */
export type AggregateSpec<TEntity> = Readonly<{
  table: string;
  columns: readonly string[];
  toRow: (entity: TEntity) => SqlRow;
  fromRow: (row: SqlRow) => TEntity;
}>;

export type AggregateStore<
  TEntity,
  TId extends string,
> = TransactionalRepository<TEntity, TId> &
  Readonly<{
    /** Column list of a `SELECT`, so a caller can add its own `WHERE`. */
    selection: string;
    versioned: (row: SqlRow) => Versioned<TEntity>;
  }>;

const MAX_DELETE_BATCH = 100;

export const valuesOf = (
  row: SqlRow,
  columns: readonly string[],
): readonly SqlValue[] => columns.map((column) => row[column] ?? null);

export function createAggregateStore<
  TEntity extends Readonly<{ id: TId }>,
  TId extends string,
>(
  session: SqlSession,
  spec: AggregateSpec<TEntity>,
): AggregateStore<TEntity, TId> {
  const { table, columns } = spec;
  const selection = columns.join(", ");
  const mutable = columns.filter((column) => column !== "id");
  const insertSql = `INSERT INTO ${table} (${selection}) VALUES (${columns.map(() => "?").join(", ")})`;
  const updateSql = `UPDATE ${table} SET ${mutable.map((column) => `${column} = ?`).join(", ")} WHERE id = ?`;

  const contextOf = (id: string): string => `${table} row ${id}`;

  const write = async (
    mutations: readonly RowMutation[],
    context: string,
  ): Promise<void> => {
    try {
      await session.write(mutations);
    } catch (cause) {
      throwTranslated(context, cause);
    }
  };

  const selectById = (id: TId): SqlStatement =>
    statement(`SELECT ${selection} FROM ${table} WHERE id = ?`, id);

  const guard = (id: TId, expectedVersion: number): SqlStatement =>
    occGuard(
      statement(
        `SELECT 1 FROM ${table} WHERE id = ? AND version = ?`,
        id,
        expectedVersion,
      ),
    );

  const readForUpdate = async (
    id: TId,
    expectedVersion: number,
  ): Promise<void> => {
    const current = await session.readRow({
      table,
      key: id,
      statement: selectById(id),
    });
    if (current === null || int(current, "version") !== expectedVersion) {
      throw optimisticLockFailure(contextOf(id));
    }
  };

  return {
    selection,

    versioned: (row: SqlRow): Versioned<TEntity> => ({
      entity: spec.fromRow(row),
      expectedVersion: int(row, "version") as ExpectedVersion<TEntity>,
    }),

    async insert(entity: TEntity): Promise<void> {
      const row = spec.toRow(entity);
      await write(
        [
          upsert({
            table,
            key: entity.id,
            row,
            statement: statement(insertSql, ...valuesOf(row, columns)),
          }),
        ],
        contextOf(entity.id),
      );
    },

    async findById(id: TId): Promise<Versioned<TEntity> | null> {
      const row = await session.readRow({
        table,
        key: id,
        statement: selectById(id),
      });
      if (row === null) {
        return null;
      }
      return {
        entity: spec.fromRow(row),
        expectedVersion: int(row, "version") as ExpectedVersion<TEntity>,
      };
    },

    async save(
      entity: TEntity,
      expectedVersion: ExpectedVersion<TEntity>,
    ): Promise<void> {
      await readForUpdate(entity.id, expectedVersion);
      const row = spec.toRow(entity);
      await write(
        [
          opaque(guard(entity.id, expectedVersion)),
          upsert({
            table,
            key: entity.id,
            row,
            statement: statement(
              updateSql,
              ...valuesOf(row, mutable),
              entity.id,
            ),
          }),
        ],
        contextOf(entity.id),
      );
    },

    async delete(
      id: TId,
      expectedVersion: ExpectedVersion<TEntity>,
    ): Promise<void> {
      await readForUpdate(id, expectedVersion);
      await write(
        [
          opaque(guard(id, expectedVersion)),
          remove({
            table,
            key: id,
            statement: statement(`DELETE FROM ${table} WHERE id = ?`, id),
          }),
        ],
        contextOf(id),
      );
    },
  };
}

/**
 * The `deleteByIds` both child repositories expose: manifest-fixed ids,
 * no OCC token, idempotent per page.
 *
 * The count comes from reading the page's surviving ids first, because
 * neither the answer nor the write can come from the driver here — a
 * scope object reaches its storage over RPC and reports no affected-row
 * count, and inside the deletion saga's unit of work the write has not
 * run yet at all. The delete itself stays one `json_each` statement
 * (`spec/database/index.md` の「共通の規約」), which is why it is staged
 * opaquely: a bulk `DELETE … WHERE` has no single-row image for the
 * read-your-writes overlay to serve.
 */
export async function deleteAggregatesByIds<TId extends string>(
  session: SqlSession,
  table: string,
  ids: readonly TId[],
): Promise<number> {
  if (ids.length > MAX_DELETE_BATCH) {
    throw new SystemError(
      SystemErrorCode.DatabaseError,
      `deleteByIds accepts at most ${MAX_DELETE_BATCH} ids`,
    );
  }
  if (ids.length === 0) {
    return 0;
  }
  const wanted = new Set<string>(ids);
  try {
    const present = await session.readRows({
      table,
      statement: statement(
        `SELECT id FROM ${table} WHERE ${inJsonList("id")}`,
        jsonList([...wanted]),
      ),
      keyOf: (row) => text(row, "id"),
      matches: (row) => wanted.has(text(row, "id")),
    });
    if (present.length === 0) {
      return 0;
    }
    const doomed = present.map((row) => text(row, "id"));
    await session.write([
      opaque({
        table,
        statement: statement(deleteRowsFromJson(table, "id"), jsonList(doomed)),
      }),
    ]);
    return doomed.length;
  } catch (cause) {
    throwTranslated(`${table} bulk delete`, cause);
  }
}
