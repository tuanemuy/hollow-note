import type { SqlRow, SqlStatement } from "../sql/statement";

/**
 * One staged change, in the two shapes a unit of work needs it in: the
 * SQL that applies it at commit, and — for anything the same unit may
 * read back — the row image that read-your-writes serves in the
 * meantime.
 *
 * An `upsert` row image carries every column that any statement reading
 * the table selects, whatever the statement shipped alongside it
 * writes. `readRows` runs the caller's `matches` and `compare` over the
 * image instead of over storage, so a column the image omits is
 * `undefined` there: `matches` turns false and the row silently leaves
 * the page, `compare` returns `NaN` and the order collapses. Building
 * the image from the same whole-row helper the table's inserts use is
 * what keeps this true as projections come and go.
 *
 * A multi-row statement — the `json_each` insert or delete that
 * `spec/database/index.md`'s 「共通の規約」 requires instead of one
 * statement per id — still names the rows it touches: `upsertMany` and
 * `removeMany` apply as a single statement while contributing the same
 * overlay entries the per-row kinds would. One statement, full
 * read-your-writes.
 *
 * `opaque` is the escape hatch for a statement with genuinely no
 * single-row meaning: an OCC guard, a counter increment, a
 * `DELETE … WHERE` whose victims are not enumerated. It applies like the
 * others but contributes nothing to the overlay, so a read issued later
 * in the same unit will not see it — which is a divergence from the
 * memory backend, not a licence. Reach for it only when the affected
 * keys are unknown at staging time.
 *
 * An `opaque` that writes a table carrying commit-time bookkeeping —
 * `scheduled_tasks`, whose write-set membership drives the due-index
 * publish and the alarm re-arm — must name that table so it reaches
 * `touchedTables()`. Statements that write no such table (an OCC guard
 * writes only `_occ_guard`) leave it unset.
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
  | Readonly<{
      kind: "upsertMany";
      table: string;
      rows: readonly (readonly [string, SqlRow])[];
      statement: SqlStatement;
    }>
  | Readonly<{
      kind: "removeMany";
      table: string;
      keys: readonly string[];
      statement: SqlStatement;
    }>
  | Readonly<{ kind: "opaque"; table?: string; statement: SqlStatement }>;

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

/**
 * One multi-row insert or update, paired with the row image each key
 * ends up with. The images must be whole rows for the reason `upsert`
 * gives, and must agree with what the statement writes — a page that
 * inserts `ON CONFLICT DO NOTHING` therefore stages images only for the
 * keys it actually creates.
 */
export const upsertMany = (
  input: Readonly<{
    table: string;
    rows: readonly (readonly [string, SqlRow])[];
    statement: SqlStatement;
  }>,
): RowMutation => ({ kind: "upsertMany", ...input });

/** One multi-row delete, paired with the keys it removes. */
export const removeMany = (
  input: Readonly<{
    table: string;
    keys: readonly string[];
    statement: SqlStatement;
  }>,
): RowMutation => ({ kind: "removeMany", ...input });

export const opaque = (
  input: SqlStatement | Readonly<{ table: string; statement: SqlStatement }>,
): RowMutation =>
  "sql" in input
    ? { kind: "opaque", statement: input }
    : { kind: "opaque", table: input.table, statement: input.statement };

/**
 * Writes staged by one open unit of work.
 *
 * Neither execution base can take the callback shape the port defines —
 * D1 has no interactive transaction and a Durable Object's
 * `transactionSync` cannot span an `await` — so a unit of work buffers
 * its writes here and applies the whole set in one atomic step at commit.
 * A callback that throws simply drops the buffer; nothing was ever
 * written.
 *
 * The statement list is plain data, which is what lets the scope plane
 * ship a whole write-set to its Durable Object in a single RPC.
 */
export class WriteSet {
  private readonly staged: SqlStatement[] = [];
  private readonly overlay = new Map<string, Map<string, SqlRow | null>>();
  private readonly touched = new Set<string>();

  stage(mutations: readonly RowMutation[]): void {
    for (const mutation of mutations) {
      this.staged.push(mutation.statement);
      if (mutation.kind === "opaque") {
        if (mutation.table !== undefined) {
          this.touched.add(mutation.table);
        }
        continue;
      }
      this.touched.add(mutation.table);
      const table = this.overlayOf(mutation.table);
      switch (mutation.kind) {
        case "upsert":
          table.set(mutation.key, mutation.row);
          break;
        case "remove":
          table.set(mutation.key, null);
          break;
        case "upsertMany":
          for (const [key, row] of mutation.rows) {
            table.set(key, row);
          }
          break;
        case "removeMany":
          for (const key of mutation.keys) {
            table.set(key, null);
          }
          break;
      }
    }
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

  statements(): readonly SqlStatement[] {
    return this.staged;
  }

  touchedTables(): readonly string[] {
    return [...this.touched];
  }

  /** True when nothing was staged. A commit with nothing to apply can
   * skip the executor entirely, which on the scope plane is one RPC
   * round trip saved. */
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
