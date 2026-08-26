import type { RowMutation, WriteSet } from "../execution/writeSet";
import { databaseError } from "./errors";
import type { SqlExecutor } from "./executor";
import type { SqlRow, SqlStatement } from "./statement";

/**
 * Reads a single row identified by its primary key.
 *
 * `key` must be built the same way the mutation that writes the row
 * builds it (`compositeKey` for multi-column keys), or read-your-writes
 * silently stops working.
 */
export type RowRead = Readonly<{
  table: string;
  key: string;
  statement: SqlStatement;
}>;

/**
 * `matches` for a statement that genuinely selects a whole table.
 *
 * `matches` is mandatory, so a whole-table read has to spell its
 * predicate out too, and `ALL_ROWS` is that predicate. Naming it is the
 * point: an omitted predicate and a deliberately universal one would
 * otherwise look identical, and the first quietly mixes every staged row
 * of the table into a filtered result.
 */
export const ALL_ROWS = (): boolean => true;

/**
 * Reads a set of rows. Everything past `statement` exists so the session
 * can merge the rows this unit of work has staged but not yet committed.
 *
 * - `keyOf` derives the same key the staging mutation used.
 * - `matches` repeats the statement's `WHERE` over a staged row image.
 *   Pass `ALL_ROWS` when the statement has no `WHERE`.
 * - `compare` repeats the statement's `ORDER BY`. Omit it when the
 *   statement has none.
 * - `limit` repeats the statement's `LIMIT`, applied after the merge.
 *
 * `limit` and same-unit writes to the rows the statement returned do not
 * compose. The overlay can only rearrange what the statement already
 * returned, so a `LIMIT n` that came back full and lost a row — to a
 * staged delete, or to a staged update that no longer satisfies
 * `matches` — would have to reach back into storage for the n+1-th row
 * to stay accurate. Under `compare` an update that keeps satisfying
 * `matches` is no better: the new values feed the sort, so the row can
 * move past the page boundary and the n+1-th row is again the one that
 * should take its place. A staged session refuses all three rather than
 * returning a page that is short or holds the wrong rows — page a set
 * you are also writing to with `query`, or write after the last page.
 */
export type RowsRead = Readonly<{
  table: string;
  statement: SqlStatement;
  keyOf: (row: SqlRow) => string;
  matches: (row: SqlRow) => boolean;
  compare?: (a: SqlRow, b: SqlRow) => number;
  limit?: number;
}>;

/**
 * What a Cloudflare repository is handed instead of a raw driver.
 *
 * A session is either **staged** — opened by a unit of work, buffering
 * writes into a `WriteSet` and serving read-your-writes from it — or
 * **autocommit**, where each `write` is its own atomic step. The same
 * repository code runs in both, which is what lets the conformance
 * suites call a port inside a `run` and straight afterwards
 * (`ConformanceBackend` exposes both shapes).
 *
 * Reads come in three flavours and the choice matters:
 *
 * - `query` goes straight to storage. Correct for aggregates
 *   (`COUNT(*)`), for `RETURNING` on an immediate write, and for
 *   anything the current unit cannot have touched.
 * - `readRow` is the primary-key read. Always overlay-aware.
 * - `readRows` is the set read. Overlay-aware **only as far as the
 *   `matches` / `compare` you supply describe the statement** — that
 *   redundancy is the price of merging staged rows into a SQL result.
 */
export interface SqlSession {
  query(input: SqlStatement): Promise<readonly SqlRow[]>;
  readRow(spec: RowRead): Promise<SqlRow | null>;
  readRows(spec: RowsRead): Promise<readonly SqlRow[]>;
  write(mutations: readonly RowMutation[]): Promise<void>;
  /**
   * One immediate write that reports how many rows it changed.
   *
   * Only an autocommit session can answer: a staged write has not run
   * yet. It exists so a bulk `DELETE` can report its size without
   * `RETURNING` a row per deletion — the response of an unbounded sweep
   * is the part that grows, not the statement count.
   */
  writeCounted(input: SqlStatement): Promise<number>;
  /** True inside a unit of work. Repositories that must refuse to run
   * outside one (or vice versa) check this rather than guessing. */
  readonly staged: boolean;
}

/**
 * Session for a port called outside any unit of work — the atomic
 * stores the design deliberately places there (`LoginAttemptStore`,
 * `OAuthStateStore`, `NoteRouteStore`, …) and the read-only services.
 * Each `write` is applied on its own and is atomic by itself.
 */
export function createAutocommitSession(executor: SqlExecutor): SqlSession {
  return {
    staged: false,
    query: (input) => executor.query(input),
    async readRow(spec: RowRead): Promise<SqlRow | null> {
      const rows = await executor.query(spec.statement);
      return rows[0] ?? null;
    },
    async readRows(spec: RowsRead): Promise<readonly SqlRow[]> {
      return executor.query(spec.statement);
    },
    async write(mutations: readonly RowMutation[]): Promise<void> {
      await executor.apply(mutations.map((mutation) => mutation.statement));
    },
    async writeCounted(input: SqlStatement): Promise<number> {
      if (executor.applyCounted === undefined) {
        throw databaseError(
          "This backend applies writes without reporting an affected-row count; use RETURNING or a separate COUNT(*)",
        );
      }
      return executor.applyCounted(input);
    },
  };
}

/**
 * Session bound to an open unit of work: writes are staged for the
 * commit and reads see them immediately.
 */
export function createStagedSession(
  executor: SqlExecutor,
  writeSet: WriteSet,
): SqlSession {
  return {
    staged: true,
    query: (input) => executor.query(input),
    async readRow(spec: RowRead): Promise<SqlRow | null> {
      const stagedRow = writeSet.peek(spec.table, spec.key);
      if (stagedRow !== undefined) {
        return stagedRow;
      }
      const rows = await executor.query(spec.statement);
      return rows[0] ?? null;
    },
    async readRows(spec: RowsRead): Promise<readonly SqlRow[]> {
      const stored = await executor.query(spec.statement);
      const staged = stored.map((row) =>
        writeSet.peek(spec.table, spec.keyOf(row)),
      );
      const unrepairable = (): string | undefined => {
        for (const row of staged) {
          if (row === null) {
            return "deleted";
          }
          if (row === undefined) {
            continue;
          }
          if (!spec.matches(row)) {
            return "updated out of the predicate";
          }
          if (spec.compare !== undefined) {
            return "updated in a way the ORDER BY may move past the page boundary";
          }
        }
        return undefined;
      };
      if (spec.limit !== undefined && stored.length >= spec.limit) {
        const reason = unrepairable();
        if (reason !== undefined) {
          throw databaseError(
            `Set read of ${spec.table} combines LIMIT ${spec.limit} with a row this unit of work ${reason}; the page cannot be completed from the overlay`,
          );
        }
      }
      // A stored row this unit has touched is dropped whichever way it
      // was touched — deleted rows stay out, rewritten ones come back
      // from the overlay with their new values.
      const merged = stored
        .filter((_, index) => staged[index] === undefined)
        .concat(
          writeSet
            .stagedRows(spec.table)
            .map(([, row]) => row)
            .filter(spec.matches),
        );
      const ordered =
        spec.compare === undefined ? merged : [...merged].sort(spec.compare);
      return spec.limit === undefined ? ordered : ordered.slice(0, spec.limit);
    },
    async write(mutations: readonly RowMutation[]): Promise<void> {
      writeSet.stage(mutations);
    },
    async writeCounted(): Promise<number> {
      throw databaseError(
        "A staged write has not run yet, so it has no affected-row count; call this outside a unit of work",
      );
    },
  };
}
