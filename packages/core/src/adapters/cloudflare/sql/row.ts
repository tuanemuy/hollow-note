import { dataIntegrityError } from "./errors";
import type { SqlRow } from "./statement";

/**
 * Column readers and writers shared by every Cloudflare repository.
 *
 * The storage conventions are `spec/database/index.md` の「共通の規約」:
 * ids are `text`, instants are `integer` UNIX milliseconds, booleans are
 * `integer` 0 / 1, enumerations are `text` with a `CHECK`, and structured
 * values are JSON `text`. These functions are the only place that
 * knowledge lives — a repository never touches a raw `SqlValue`.
 *
 * Every reader throws `SystemError(DataIntegrityError)` when the stored
 * value contradicts the schema, which is what tells a broken migration
 * apart from a driver fault (`SystemError(DatabaseError)`).
 */

const missing = (column: string, expected: string): never => {
  throw dataIntegrityError(`Column ${column} is not ${expected}`);
};

export const text = (row: SqlRow, column: string): string => {
  const value = row[column];
  return typeof value === "string" ? value : missing(column, "text");
};

export const textOrNull = (row: SqlRow, column: string): string | null => {
  const value = row[column];
  if (value === null || value === undefined) {
    return null;
  }
  return typeof value === "string" ? value : missing(column, "text or null");
};

export const int = (row: SqlRow, column: string): number => {
  const value = row[column];
  return typeof value === "number" ? value : missing(column, "an integer");
};

export const intOrNull = (row: SqlRow, column: string): number | null => {
  const value = row[column];
  if (value === null || value === undefined) {
    return null;
  }
  return typeof value === "number"
    ? value
    : missing(column, "an integer or null");
};

export const bool = (row: SqlRow, column: string): boolean =>
  int(row, column) !== 0;

export const date = (row: SqlRow, column: string): Date =>
  new Date(int(row, column));

export const dateOrNull = (row: SqlRow, column: string): Date | null => {
  const value = intOrNull(row, column);
  return value === null ? null : new Date(value);
};

export const json = <T>(row: SqlRow, column: string): T => {
  const raw = text(row, column);
  try {
    return JSON.parse(raw) as T;
  } catch (cause) {
    throw dataIntegrityError(`Column ${column} is not valid JSON: ${cause}`);
  }
};

export const jsonOrNull = <T>(row: SqlRow, column: string): T | null => {
  const raw = textOrNull(row, column);
  if (raw === null) {
    return null;
  }
  try {
    return JSON.parse(raw) as T;
  } catch (cause) {
    throw dataIntegrityError(`Column ${column} is not valid JSON: ${cause}`);
  }
};

/**
 * Reads a `text` column constrained to a closed set. The `CHECK` in the
 * schema is the first line of defence; this is what turns a row that
 * predates a narrowing migration into a data-integrity fault rather than
 * a value the domain cannot represent.
 */
export const enumOf = <T extends string>(
  row: SqlRow,
  column: string,
  allowed: readonly T[],
): T => {
  const value = text(row, column);
  return (allowed as readonly string[]).includes(value)
    ? (value as T)
    : missing(column, `one of ${allowed.join(" / ")}`);
};

export const toTimestamp = (value: Date): number => value.getTime();

export const toTimestampOrNull = (value: Date | null): number | null =>
  value === null ? null : value.getTime();

export const toBool = (value: boolean): number => (value ? 1 : 0);

export const toJson = (value: unknown): string => JSON.stringify(value);

/**
 * Composite key encoding for the write-set overlay and for the two-part
 * keys the schema folds into one column. NUL cannot occur in any of the
 * parts, so the join is unambiguous; the escape sequence (not a raw
 * byte) keeps call sites greppable.
 */
export const compositeKey = (...parts: readonly string[]): string =>
  parts.join("\u0000");
