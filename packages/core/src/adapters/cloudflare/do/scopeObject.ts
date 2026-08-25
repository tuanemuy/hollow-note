import { DurableObject } from "cloudflare:workers";
import { SCOPE_TASK_LEASE_MS } from "../../../application/ports/scopeTaskScheduler";
import type { ScopeKey } from "../../../application/scope";
import { dataIntegrityError } from "../sql/errors";
import { createD1Executor } from "../sql/executor";
import { text } from "../sql/row";
import { type SqlRow, type SqlStatement, statement } from "../sql/statement";
import { rescheduleAlarm, runScopeAlarmTurn } from "./alarm";
import { dueIndexStatements } from "./dueIndex";
import { dueIndexRowsStatement } from "./scheduledTasks";
import {
  SCHEDULED_TASKS_TABLE,
  SCOPE_SCHEMA_STATEMENTS,
  SCOPE_TABLES,
} from "./schema";
import { scopeFromColumns } from "./scopeName";

export type ScopeObjectEnv = Readonly<{
  /** Global D1, needed for the scope-task due index (ADR 003). */
  GLOBAL_DB: D1Database;
}>;

/**
 * One scope of the data plane, as a SQLite-backed Durable Object.
 *
 * The object is a **generic scope store**, not a place usecases run:
 * `ScopeUnitOfWorkProvider.run(scope, fn)` takes an arbitrary closure,
 * which cannot cross an RPC boundary, so the callback stays in the
 * caller's isolate and this object receives only two kinds of message —
 * a read, and a finished write-set to apply
 * ([ADR 002](../../../../../.thread/11/adr.md)). Keeping it that way is
 * what stops the whole application bundle from becoming a redeploy
 * reason for storage.
 *
 * `applyWriteSet` is the plane's atomic unit: `ctx.storage.transactionSync`
 * runs the statements with no `await` in between, which is both what the
 * API allows and what `spec/platform/index.md`「外部要求」requires.
 *
 * The object binds its own `ScopeKey` on first contact and refuses a
 * mismatched one afterwards. Callers pass the key on every call rather
 * than relying on the object's name, because the name carries a test
 * namespace prefix (`./scopeName.ts`) that the stored rows must not.
 */
export class ScopeObject extends DurableObject<ScopeObjectEnv> {
  constructor(ctx: DurableObjectState, env: ScopeObjectEnv) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      for (const ddl of SCOPE_SCHEMA_STATEMENTS) {
        ctx.storage.sql.exec(ddl);
      }
    });
  }

  async query(
    scopeKey: string,
    input: SqlStatement,
  ): Promise<readonly SqlRow[]> {
    this.bind(scopeKey);
    return this.exec(input);
  }

  async applyWriteSet(
    scopeKey: string,
    statements: readonly SqlStatement[],
    touchedTables: readonly string[],
  ): Promise<void> {
    const scope = this.bind(scopeKey);
    if (statements.length > 0) {
      this.ctx.storage.transactionSync(() => {
        for (const input of statements) {
          this.exec(input);
        }
      });
    }
    if (touchedTables.includes(SCHEDULED_TASKS_TABLE)) {
      await this.publishDueIndex(scope);
      await rescheduleAlarm(this.ctx.storage);
    }
  }

  override async alarm(): Promise<void> {
    const bound = this.boundScope();
    if (bound === null) {
      await this.ctx.storage.deleteAlarm();
      return;
    }
    await runScopeAlarmTurn({
      storage: this.ctx.storage,
      scope: bound,
      now: new Date(),
      leaseMs: SCOPE_TASK_LEASE_MS,
    });
    await this.publishDueIndex(bound);
    await rescheduleAlarm(this.ctx.storage);
  }

  private async publishDueIndex(scope: ScopeKey): Promise<void> {
    const rows = this.exec(dueIndexRowsStatement());
    const columns =
      scope.type === "user"
        ? { type: "user", id: scope.userId }
        : { type: "workspace", id: scope.workspaceId };
    await createD1Executor(this.env.GLOBAL_DB).apply(
      dueIndexStatements(columns, rows),
    );
  }

  private boundScope(): ScopeKey | null {
    const rows = this.exec(
      statement(
        `SELECT scope_type, scope_id FROM ${SCOPE_TABLES.scopeIdentity} WHERE id = 0`,
      ),
    );
    const row = rows[0];
    return row === undefined
      ? null
      : scopeFromColumns(text(row, "scope_type"), text(row, "scope_id"));
  }

  /**
   * Pins the object's identity the first time it is addressed and checks
   * it on every call afterwards. A mismatch means two scopes reached one
   * object, which would let a row escape the `scope 検証` rule of
   * `spec/database/index.md` の「共通の規約」.
   */
  private bind(scopeKey: string): ScopeKey {
    const separator = scopeKey.indexOf(":");
    const type = scopeKey.slice(0, separator);
    const id = scopeKey.slice(separator + 1);
    if (separator < 0 || (type !== "user" && type !== "workspace")) {
      throw dataIntegrityError(`Malformed scope key ${scopeKey}`);
    }
    this.exec(
      statement(
        `INSERT INTO ${SCOPE_TABLES.scopeIdentity} (id, scope_type, scope_id)
         VALUES (0, ?, ?) ON CONFLICT (id) DO NOTHING`,
        type,
        id,
      ),
    );
    const bound = this.boundScope();
    if (bound === null) {
      throw dataIntegrityError("Scope object identity could not be pinned");
    }
    const boundKey =
      bound.type === "user"
        ? `user:${bound.userId}`
        : `workspace:${bound.workspaceId}`;
    if (boundKey !== scopeKey) {
      throw dataIntegrityError(
        `Scope object is bound to ${boundKey} but was addressed as ${scopeKey}`,
      );
    }
    return bound;
  }

  private exec(input: SqlStatement): readonly SqlRow[] {
    return this.ctx.storage.sql
      .exec(input.sql, ...input.params)
      .toArray() as unknown as SqlRow[];
  }
}
