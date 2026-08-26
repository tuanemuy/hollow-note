import { DurableObject } from "cloudflare:workers";
import { ConsoleLogger } from "../../../application/ports/logger";
import { SCOPE_TASK_LEASE_MS } from "../../../application/ports/scopeTaskScheduler";
import type { ScopeKey } from "../../../application/scope";
import { ScopeKey as ScopeKeyOps } from "../../../application/scope";
import { dataIntegrityError } from "../sql/errors";
import {
  createD1Executor,
  createStorageExecutor,
  type SqlExecutor,
} from "../sql/executor";
import { text } from "../sql/row";
import { type SqlRow, type SqlStatement, statement } from "../sql/statement";
import { armNoLaterThan, rescheduleAlarm, runScopeAlarmTurn } from "./alarm";
import { DUE_INDEX_REPUBLISH_DELAY_MS, dueIndexStatements } from "./dueIndex";
import { dueIndexRowsStatement } from "./scheduledTasks";
import {
  SCHEDULED_TASKS_TABLE,
  SCOPE_SCHEMA_STATEMENTS,
  SCOPE_TABLES,
} from "./schema";
import {
  scopeColumns,
  scopeColumnsFromName,
  scopeFromColumns,
} from "./scopeName";

const REARM_FAILED = "scope alarm rearm failed";

const tolerate = async (
  message: string,
  run: () => Promise<void>,
): Promise<void> => {
  try {
    await run();
  } catch (cause) {
    ConsoleLogger.warn(message, { cause });
  }
};

export type ScopeObjectEnv = Readonly<{
  /**
   * Global D1. The object writes its own slice of `scope_task_due_index`
   * there, because Durable Objects cannot be enumerated and
   * `ScopeTaskQueue.listDue` has to span every scope.
   */
  GLOBAL_DB: D1Database;
}>;

/**
 * One scope of the data plane, as a SQLite-backed Durable Object.
 *
 * The object is a **generic scope store**, not a place usecases run:
 * `ScopeUnitOfWorkProvider.run(scope, fn)` takes an arbitrary closure,
 * which cannot cross an RPC boundary, so the callback stays in the
 * caller's isolate and this object receives only two kinds of message —
 * a read, and a finished write-set to apply. Keeping it that way is
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
 * namespace prefix (`./scopeName.ts`) that the stored rows must not. The
 * pin is read once at construction and held in the instance, so an
 * addressed key costs a string comparison rather than a write and a read
 * on every RPC.
 */
export class ScopeObject extends DurableObject<ScopeObjectEnv> {
  private readonly sql: SqlExecutor;
  private pinned: Readonly<{ scope: ScopeKey; key: string }> | null = null;

  constructor(ctx: DurableObjectState, env: ScopeObjectEnv) {
    super(ctx, env);
    this.sql = createStorageExecutor(ctx.storage);
    ctx.blockConcurrencyWhile(async () => {
      for (const ddl of SCOPE_SCHEMA_STATEMENTS) {
        ctx.storage.sql.exec(ddl);
      }
      const stored = await this.boundScope();
      if (stored !== null) {
        this.pinned = { scope: stored, key: ScopeKeyOps.serialize(stored) };
        // Arming happens on a committed write-set or at the end of a
        // turn, and a turn needs an alarm to exist first. Rows left by a
        // deployment that drove no tasks from the object would otherwise
        // wait for the next write to this scope; one pass here closes
        // that circle, and drops the alarm again where nothing drives it.
        await tolerate(REARM_FAILED, () => rescheduleAlarm(ctx.storage));
      }
    });
  }

  async query(
    scopeKey: string,
    input: SqlStatement,
  ): Promise<readonly SqlRow[]> {
    await this.bind(scopeKey);
    return this.sql.query(input);
  }

  async applyWriteSet(
    scopeKey: string,
    statements: readonly SqlStatement[],
    touchedTables: readonly string[],
  ): Promise<void> {
    const scope = await this.bind(scopeKey);
    await this.sql.apply(statements);
    if (touchedTables.includes(SCHEDULED_TASKS_TABLE)) {
      await this.armAndPublish(scope);
    }
  }

  override async alarm(): Promise<void> {
    const bound = this.pinned?.scope ?? (await this.boundScope());
    if (bound === null) {
      await this.ctx.storage.deleteAlarm();
      return;
    }
    try {
      await runScopeAlarmTurn({
        storage: this.ctx.storage,
        scope: bound,
        now: new Date(),
        leaseMs: SCOPE_TASK_LEASE_MS,
      });
    } finally {
      // A turn that throws must not take the arming with it: an object
      // left unarmed has no next turn, so its rows would stop for good
      // rather than for one lease. The failure itself still propagates,
      // which is what makes the runtime redeliver the alarm.
      await this.armAndPublish(bound);
    }
  }

  /**
   * Upkeep that follows a landed change to `scheduled_tasks`: arm the
   * object, then republish its slice of the due index.
   *
   * Both are derived state, so neither failure may reach the caller — the
   * write they follow has already committed, and reporting a failure
   * would invite a retry of work that took effect. They are tolerated
   * independently: a scope that is only in the index is still reachable
   * by the central runner.
   *
   * A failed publish is the one direction nothing else covers, since
   * `listDue` reads the index alone and a scope missing from it is never
   * looked for again. So the failure arms the object for a retry, which
   * has to happen after `rescheduleAlarm` — that call drops the alarm
   * outright where this deployment drives no tasks from the object, and
   * would otherwise erase the retry.
   */
  private async armAndPublish(scope: ScopeKey): Promise<void> {
    // Arming first keeps the object's self-healing independent of D1.
    await tolerate(REARM_FAILED, () => rescheduleAlarm(this.ctx.storage));
    try {
      await this.publishDueIndex(scope);
    } catch (cause) {
      ConsoleLogger.warn("scope task due index publish failed", { cause });
      await tolerate(REARM_FAILED, () =>
        armNoLaterThan(
          this.ctx.storage,
          Date.now() + DUE_INDEX_REPUBLISH_DELAY_MS,
        ),
      );
    }
  }

  private async publishDueIndex(scope: ScopeKey): Promise<void> {
    const rows = await this.sql.query(dueIndexRowsStatement());
    await createD1Executor(this.env.GLOBAL_DB).apply(
      dueIndexStatements(scopeColumns(scope), rows),
    );
  }

  private async boundScope(): Promise<ScopeKey | null> {
    const rows = await this.sql.query(
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
  private async bind(scopeKey: string): Promise<ScopeKey> {
    const pinned = this.pinned;
    if (pinned !== null) {
      return this.assertAddressed(pinned, scopeKey);
    }
    const columns = scopeColumnsFromName(scopeKey);
    await this.sql.apply([
      statement(
        `INSERT INTO ${SCOPE_TABLES.scopeIdentity} (id, scope_type, scope_id)
         VALUES (0, ?, ?) ON CONFLICT (id) DO NOTHING`,
        columns.type,
        columns.id,
      ),
    ]);
    const stored = await this.boundScope();
    if (stored === null) {
      throw dataIntegrityError("Scope object identity could not be pinned");
    }
    const bound = { scope: stored, key: ScopeKeyOps.serialize(stored) };
    this.pinned = bound;
    return this.assertAddressed(bound, scopeKey);
  }

  private assertAddressed(
    bound: Readonly<{ scope: ScopeKey; key: string }>,
    scopeKey: string,
  ): ScopeKey {
    if (bound.key !== scopeKey) {
      throw dataIntegrityError(
        `Scope object is bound to ${bound.key} but was addressed as ${scopeKey}`,
      );
    }
    return bound.scope;
  }
}
