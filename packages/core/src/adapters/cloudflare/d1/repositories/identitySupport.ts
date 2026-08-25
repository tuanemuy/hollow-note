import type { PrunePage } from "../../../../domain/common/pagination";
import type { RowMutation } from "../../execution/writeSet";
import { remove } from "../../execution/writeSet";
import { throwTranslated } from "../../sql/errors";
import { text, toTimestamp } from "../../sql/row";
import type { SqlSession } from "../../sql/session";
import type { SqlRow, SqlStatement, SqlValue } from "../../sql/statement";
import { statement } from "../../sql/statement";

/** Statement shapes shared by the D1 Identity repositories. */

/** Builds the row-writing statements of one table from its column list. */
export function createTableWriter(
  table: string,
  columns: readonly string[],
  key: readonly string[],
) {
  const columnList = columns.join(", ");
  const placeholders = columns.map(() => "?").join(", ");
  const insertSql = `INSERT INTO ${table} (${columnList}) VALUES (${placeholders})`;
  const conflictTarget = `(${key.join(", ")})`;
  const assignments = columns
    .filter((column) => !key.includes(column))
    .map((column) => `${column} = excluded.${column}`)
    .join(", ");
  const params = (row: SqlRow): readonly SqlValue[] =>
    columns.map((column) => row[column] ?? null);
  return {
    insert: (row: SqlRow): SqlStatement => ({
      sql: insertSql,
      params: params(row),
    }),
    upsert: (row: SqlRow): SqlStatement => ({
      sql: `${insertSql} ON CONFLICT${conflictTarget} DO UPDATE SET ${assignments}`,
      params: params(row),
    }),
    insertIgnore: (row: SqlRow): SqlStatement => ({
      sql: `${insertSql} ON CONFLICT${conflictTarget} DO NOTHING`,
      params: params(row),
    }),
  };
}

/**
 * Applies mutations and translates a driver failure into the shared
 * error contracts. Inside a unit of work `write` only stages, so the
 * translation that matters there happens at commit; outside one this is
 * the adapter → application boundary.
 */
export async function writeTranslated(
  session: SqlSession,
  context: string,
  mutations: readonly RowMutation[],
): Promise<void> {
  try {
    await session.write(mutations);
  } catch (cause) {
    throwTranslated(context, cause);
  }
}

/**
 * One bounded pass of an expiry sweep.
 *
 * `expiresAt <= now` is a filter, never part of the ordering: rows are
 * ordered and paged by the table key alone, starting after `cursor`.
 * A keyset (rather than an OFFSET) is what keeps concurrent deletions
 * ahead of the cursor from skipping rows.
 */
export async function deleteExpiredPage(
  session: SqlSession,
  spec: Readonly<{ table: string; keyColumn: string; expiresColumn: string }>,
  now: Date,
  cursor: string | null,
  limit: number,
): Promise<PrunePage> {
  const size = Math.max(0, Math.trunc(limit));
  if (size === 0) {
    return { deleted: 0, nextCursor: null };
  }
  const rows = await session.query(
    statement(
      `SELECT ${spec.keyColumn} AS sweep_key FROM ${spec.table}
       WHERE ${spec.expiresColumn} <= ? AND (? IS NULL OR ${spec.keyColumn} > ?)
       ORDER BY ${spec.keyColumn} LIMIT ?`,
      toTimestamp(now),
      cursor,
      cursor,
      size + 1,
    ),
  );
  const keys = rows.map((row) => text(row, "sweep_key"));
  const page = keys.slice(0, size);
  if (page.length > 0) {
    await writeTranslated(
      session,
      `${spec.table} expiry sweep`,
      page.map((key) =>
        remove({
          table: spec.table,
          key,
          statement: statement(
            `DELETE FROM ${spec.table} WHERE ${spec.keyColumn} = ?`,
            key,
          ),
        }),
      ),
    );
  }
  const last = page[page.length - 1];
  return {
    deleted: page.length,
    nextCursor: keys.length > size && last !== undefined ? last : null,
  };
}

/**
 * Deletes the first `limit` rows of a filtered set, ordered by primary
 * key, and answers how many went. Every bounded delete of the bundle
 * (`deleteOlderEpochByUser`, `deleteByUserAndPurpose`) has this shape.
 */
export async function deleteBoundedByKey(
  session: SqlSession,
  spec: Readonly<{ table: string; keyColumn: string; where: SqlStatement }>,
  limit: number,
): Promise<number> {
  const size = Math.max(0, Math.trunc(limit));
  if (size === 0) {
    return 0;
  }
  const rows = await session.query({
    sql: `SELECT ${spec.keyColumn} AS delete_key FROM ${spec.table}
          WHERE ${spec.where.sql}
          ORDER BY ${spec.keyColumn} LIMIT ?`,
    params: [...spec.where.params, size],
  });
  const keys = rows.map((row) => text(row, "delete_key"));
  if (keys.length === 0) {
    return 0;
  }
  await writeTranslated(
    session,
    `${spec.table} bounded delete`,
    keys.map((key) =>
      remove({
        table: spec.table,
        key,
        statement: statement(
          `DELETE FROM ${spec.table} WHERE ${spec.keyColumn} = ?`,
          key,
        ),
      }),
    ),
  );
  return keys.length;
}
