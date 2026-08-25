import type { SqlRow, SqlStatement } from "../sql/statement";

/**
 * One staged change, in the two shapes a unit of work needs it in: the
 * SQL that applies it at commit, and — for anything the same unit may
 * read back — the row image that read-your-writes serves in the
 * meantime.
 *
 * `opaque` is the escape hatch for a statement with no single-row
 * meaning: an OCC guard, a counter increment, a bulk `DELETE … WHERE`.
 * It applies like the others but contributes nothing to the overlay, so
 * a read issued later in the same unit will not see it. Use `upsert` /
 * `remove` whenever the affected row can be read back before commit.
 */
export type RowMutation =
  | Readonly<{
      kind: "upsert";
      table: string;
      key: string;
      row: SqlRow;
      statement: SqlStatement;
    }>
  | Readonly<{
      kind: "remove";
      table: string;
      key: string;
      statement: SqlStatement;
    }>
  | Readonly<{ kind: "opaque"; statement: SqlStatement }>;

export const upsert = (
  input: Readonly<{
    table: string;
    key: string;
    row: SqlRow;
    statement: SqlStatement;
  }>,
): RowMutation => ({ kind: "upsert", ...input });

export const remove = (
  input: Readonly<{ table: string; key: string; statement: SqlStatement }>,
): RowMutation => ({ kind: "remove", ...input });

export const opaque = (input: SqlStatement): RowMutation => ({
  kind: "opaque",
  statement: input,
});

/**
 * Writes staged by one open unit of work.
 *
 * Neither execution base can take the callback shape the port defines —
 * D1 has no interactive transaction and a Durable Object's
 * `transactionSync` cannot span an `await` — so a unit of work buffers
 * its writes here and applies the whole set in one atomic step at commit
 * ([ADR 001](../../../../../.thread/11/adr.md)). A callback that throws
 * simply drops the buffer; nothing was ever written.
 *
 * The statement list is plain data, which is what lets the scope plane
 * ship a whole write-set to its Durable Object in a single RPC
 * ([ADR 002](../../../../../.thread/11/adr.md)).
 */
export class WriteSet {
  private readonly staged: SqlStatement[] = [];
  private readonly overlay = new Map<string, Map<string, SqlRow | null>>();
  private readonly touched = new Set<string>();

  stage(mutations: readonly RowMutation[]): void {
    for (const mutation of mutations) {
      this.staged.push(mutation.statement);
      if (mutation.kind === "opaque") {
        continue;
      }
      this.touched.add(mutation.table);
      const table = this.overlayOf(mutation.table);
      table.set(mutation.key, mutation.kind === "upsert" ? mutation.row : null);
    }
  }

  /** Marks a table as written without staging a row image, for `opaque`
   * statements whose target still has to reach the commit-time hooks
   * (the scope-task due index, say). */
  markTouched(table: string): void {
    this.touched.add(table);
  }

  /**
   * `undefined` when this unit has not written the row (the caller must
   * fall through to storage), `null` when it deleted it.
   */
  peek(table: string, key: string): SqlRow | null | undefined {
    return this.overlay.get(table)?.get(key);
  }

  /** Row images this unit staged for `table`, deletions excluded. */
  stagedRows(table: string): readonly (readonly [string, SqlRow])[] {
    const rows = this.overlay.get(table);
    if (rows === undefined) {
      return [];
    }
    const staged: (readonly [string, SqlRow])[] = [];
    for (const [key, row] of rows) {
      if (row !== null) {
        staged.push([key, row]);
      }
    }
    return staged;
  }

  /** Keys this unit deleted from `table`. */
  stagedDeletions(table: string): readonly string[] {
    const rows = this.overlay.get(table);
    if (rows === undefined) {
      return [];
    }
    const deleted: string[] = [];
    for (const [key, row] of rows) {
      if (row === null) {
        deleted.push(key);
      }
    }
    return deleted;
  }

  statements(): readonly SqlStatement[] {
    return this.staged;
  }

  touchedTables(): readonly string[] {
    return [...this.touched];
  }

  isEmpty(): boolean {
    return this.staged.length === 0;
  }

  private overlayOf(table: string): Map<string, SqlRow | null> {
    const existing = this.overlay.get(table);
    if (existing !== undefined) {
      return existing;
    }
    const created = new Map<string, SqlRow | null>();
    this.overlay.set(table, created);
    return created;
  }
}
