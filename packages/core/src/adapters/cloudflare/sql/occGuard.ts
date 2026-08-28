import { OCC_GUARD_CONSTRAINT } from "./errors";
import type { SqlStatement } from "./statement";

/**
 * The `_occ_guard` trip wire (`spec/database/index.md` 物理配置, both planes).
 *
 * A write-set commits as one D1 `batch()` or one DO `transactionSync`,
 * and neither aborts because a conditional `UPDATE … WHERE version = ?`
 * matched zero rows — SQLite reports "0 rows changed", not an error. The
 * guard supplies the missing abort: it is an `INSERT` that only executes
 * when the expected condition is **false**, and whose row can never
 * satisfy the table's `CHECK`. The constraint violation aborts the whole
 * unit atomically, and `classifySqlError` recognises it by the
 * constraint name.
 *
 * The table therefore never holds a row. It exists to be violated.
 *
 * Stage the guard **before** the statement it protects: within one batch
 * each statement sees the effects of the previous ones, so a guard that
 * ran after the `UPDATE` would be reading the version it just wrote.
 *
 * @example Optimistic lock on an aggregate root
 * ```ts
 * session.write([
 *   opaque(occGuard(statement(
 *     "SELECT 1 FROM notes WHERE id = ? AND version = ?", id, expected,
 *   ))),
 *   upsert({ table: "notes", key: id, row, statement: updateStatement }),
 * ]);
 * ```
 */
export const OCC_GUARD_TABLE = "_occ_guard";

export const OCC_GUARD_DDL = `CREATE TABLE ${OCC_GUARD_TABLE} (
  id integer PRIMARY KEY,
  CONSTRAINT ${OCC_GUARD_CONSTRAINT} CHECK (id <> 0)
)`;

/**
 * Turns "this must still hold at commit time" into a statement that
 * aborts the batch when it does not. `condition` is any `SELECT` that
 * returns at least one row exactly when the expectation holds.
 */
export const occGuard = (condition: SqlStatement): SqlStatement => ({
  sql: `INSERT INTO ${OCC_GUARD_TABLE} (id) SELECT 0 WHERE NOT EXISTS (${condition.sql})`,
  params: condition.params,
});
