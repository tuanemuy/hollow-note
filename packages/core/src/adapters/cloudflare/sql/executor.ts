import { databaseError } from "./errors";
import { assertBindable } from "./json";
import {
  MAX_STATEMENTS_PER_COMMIT,
  type SqlRow,
  type SqlStatement,
} from "./statement";

/**
 * The single seam every Cloudflare repository reads and writes through.
 *
 * Three implementations exist and they are interchangeable by design:
 * D1 (`createD1Executor`), a scope Durable Object reached over RPC
 * (`createScopeStubExecutor` in `../do/scopeStub.ts`), and the same
 * object's own storage seen from inside it (`createStorageExecutor`).
 * `apply` is **atomic**: either every statement lands or none does.
 *
 * `apply` is the only write path. Repositories never call it — they
 * hand mutations to a `SqlSession`, which either applies them straight
 * away (outside a unit of work) or stages them for the commit.
 */
export interface SqlExecutor {
  query(input: SqlStatement): Promise<readonly SqlRow[]>;
  apply(statements: readonly SqlStatement[]): Promise<void>;
  /**
   * Applies one write and reports how many rows it changed.
   *
   * Optional because it is a property of the driver's response, not of
   * the seam: D1 carries `meta.changes` on every result, while the scope
   * plane reaches its storage over RPC and gets nothing back. Callers
   * that need a count reach it through `SqlSession.writeCounted`, which
   * fails loudly on a backend that cannot answer.
   */
  applyCounted?(input: SqlStatement): Promise<number>;
}

/**
 * Executor for one scope object. Committing a scope unit of work goes
 * through `applyWriteSet` rather than `apply` because the object has
 * bookkeeping to do that depends on *which* tables changed: a write-set
 * that touched `scheduled_tasks` must leave the global due index
 * refreshed before the call returns, which is what makes a task visible
 * to `ScopeTaskQueue.listDue` the moment `run` resolves.
 */
export interface ScopeSqlExecutor extends SqlExecutor {
  applyWriteSet(
    statements: readonly SqlStatement[],
    touchedTables: readonly string[],
  ): Promise<void>;
}

/**
 * D1: `batch()` is the only atomic unit the driver offers — there is no
 * interactive transaction — so a whole write-set is exactly one batch.
 *
 * `MAX_STATEMENTS_PER_COMMIT` is enforced here rather than at the unit of
 * work, because every atomic write on this plane arrives through `apply`
 * — a commit and an autocommit `write` alike — and each spends its
 * statement count out of the same invocation query budget.
 */
export function createD1Executor(db: D1Database): SqlExecutor {
  const prepare = (input: SqlStatement): D1PreparedStatement => {
    assertBindable(input);
    const prepared = db.prepare(input.sql);
    return input.params.length === 0
      ? prepared
      : prepared.bind(...input.params);
  };
  return {
    async query(input: SqlStatement): Promise<readonly SqlRow[]> {
      const result = await prepare(input).all<SqlRow>();
      return result.results;
    },
    async apply(statements: readonly SqlStatement[]): Promise<void> {
      if (statements.length === 0) {
        return;
      }
      if (statements.length > MAX_STATEMENTS_PER_COMMIT) {
        throw databaseError(
          `A single atomic write staged ${statements.length} statements, above the ${MAX_STATEMENTS_PER_COMMIT} it may spend from the D1 invocation budget; split the work into bounded batches`,
        );
      }
      if (statements.length === 1) {
        // `batch` of one still costs a round trip through the batch
        // path; `run` is the same atomic unit for a single statement.
        await prepare(statements[0] as SqlStatement).run();
        return;
      }
      await db.batch(statements.map(prepare));
    },
    async applyCounted(input: SqlStatement): Promise<number> {
      const result = await prepare(input).run();
      return result.meta.changes;
    },
  };
}

/**
 * A Durable Object's own SQL storage, and the only path `ScopeObject`
 * takes to it — which is what puts the binding limit `assertBindable`
 * enforces on both planes rather than only on D1. `transactionSync`
 * cannot span an `await`, which is why the whole write-set arrives as
 * data before this runs.
 */
export function createStorageExecutor(
  storage: DurableObjectStorage,
): SqlExecutor {
  const exec = (input: SqlStatement): SqlRow[] => {
    assertBindable(input);
    return storage.sql
      .exec(input.sql, ...input.params)
      .toArray() as unknown as SqlRow[];
  };
  return {
    async query(input: SqlStatement): Promise<readonly SqlRow[]> {
      return exec(input);
    },
    async apply(statements: readonly SqlStatement[]): Promise<void> {
      if (statements.length === 0) {
        return;
      }
      storage.transactionSync(() => {
        for (const input of statements) {
          exec(input);
        }
      });
    },
  };
}
