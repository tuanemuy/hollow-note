import { databaseError } from "./errors";
import {
  MAX_BOUND_PARAMETERS,
  type SqlStatement,
  type SqlValue,
} from "./statement";

/**
 * `json_each` expansion — the only sanctioned way to bind a list.
 *
 * Both planes cap a statement at 100 bound parameters, while
 * `NoteRouteStore.resolveMany` takes up to 500 ids and
 * `UserBatchReader.resolveMany` up to 100. The rule is therefore absolute:
 * **ID の並びで引く / 消す / 入れるクエリは `?` を件数ぶん並べない** — pass
 * one JSON array as a single binding and expand it with `json_each`.
 * Multi-row INSERT and DELETE follow the same shape, which is also what
 * lets a bulk delete collapse its writes into the single atomic apply the
 * execution budget asks for.
 *
 * @example Read a list of ids
 * ```ts
 * const rows = await session.query(
 *   statement(
 *     `SELECT * FROM users WHERE ${inJsonList("id")}`,
 *     jsonList(ids),
 *   ),
 * );
 * ```
 */

/** Serializes a list of scalars for a single binding. */
export const jsonList = (values: readonly string[]): string =>
  JSON.stringify(values);

/** Serializes a list of row objects for a single binding. */
export const jsonRows = (
  rows: readonly Readonly<Record<string, SqlValue | boolean>>[],
): string => JSON.stringify(rows);

/**
 * `column IN (SELECT value FROM json_each(?))` — expands the next
 * positional binding, which must be a `jsonList(...)` value.
 */
export const inJsonList = (column: string): string =>
  `${column} IN (SELECT value FROM json_each(?))`;

/** The negation of {@link inJsonList}, expanding the same binding shape. */
export const notInJsonList = (column: string): string =>
  `${column} NOT IN (SELECT value FROM json_each(?))`;

/**
 * Builds `INSERT INTO table (cols…) SELECT json_extract(…) FROM json_each(?)`.
 * The single binding is a `jsonRows(...)` value whose objects carry one
 * property per column, named exactly as the column.
 *
 * `conflict` picks the upsert clause: `"fail"` lets a duplicate key
 * raise (the caller then classifies it), `"ignore"` makes a duplicate a
 * no-op, and a list of columns updates those columns on conflict.
 */
export function insertRowsFromJson(input: {
  table: string;
  columns: readonly string[];
  conflictKey?: readonly string[];
  conflict?: "fail" | "ignore" | readonly string[];
}): string {
  const projection = input.columns
    .map((column) => `json_extract(value, '$.${column}') AS ${column}`)
    .join(", ");
  const head = `INSERT INTO ${input.table} (${input.columns.join(", ")}) SELECT ${projection} FROM json_each(?)`;
  const conflict = input.conflict ?? "fail";
  if (conflict === "fail") {
    return head;
  }
  // `WHERE true` is not a filter: SQLite cannot tell an upsert clause
  // from a join constraint after a `SELECT … FROM`, and the trailing
  // `WHERE` is what resolves the ambiguity.
  const body = `${head} WHERE true`;
  const key = input.conflictKey ?? [];
  const target = key.length > 0 ? `(${key.join(", ")})` : "";
  if (conflict === "ignore") {
    return `${body} ON CONFLICT${target} DO NOTHING`;
  }
  const assignments = conflict
    .map((column) => `${column} = excluded.${column}`)
    .join(", ");
  return `${body} ON CONFLICT${target} DO UPDATE SET ${assignments}`;
}

/**
 * `DELETE FROM table WHERE column IN (SELECT value FROM json_each(?))`
 * — one statement whatever the number of keys.
 */
export const deleteRowsFromJson = (table: string, column: string): string =>
  `DELETE FROM ${table} WHERE ${inJsonList(column)}`;

/**
 * Guards a statement against the binding cap before it reaches the
 * driver. A statement that trips this is a bug in the adapter, not a
 * runtime condition — the message names the count so the offending call
 * site is obvious.
 */
export function assertBindable(input: SqlStatement): SqlStatement {
  if (input.params.length > MAX_BOUND_PARAMETERS) {
    throw databaseError(
      `Statement binds ${input.params.length} parameters, above the ${MAX_BOUND_PARAMETERS} limit; expand lists with json_each instead`,
    );
  }
  return input;
}
