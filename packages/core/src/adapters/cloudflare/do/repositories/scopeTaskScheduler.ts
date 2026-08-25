import {
  ConsoleLogger,
  type Logger,
} from "../../../../application/ports/logger";
import {
  type ClaimDueScopeTasksArgs,
  SCOPE_TASK_MAX_ATTEMPTS,
  type ScopeTask,
  type ScopeTaskPayload,
  type ScopeTaskPriority,
  type ScopeTaskScheduler,
} from "../../../../application/ports/scopeTaskScheduler";
import type { ScopeKey } from "../../../../application/scope";
import {
  opaque,
  type RowMutation,
  remove,
  upsert,
} from "../../execution/writeSet";
import { throwTranslated } from "../../sql/errors";
import { createD1Executor } from "../../sql/executor";
import { occGuard } from "../../sql/occGuard";
import { int, text, toJson, toTimestamp } from "../../sql/row";
import type { SqlSession } from "../../sql/session";
import { type SqlRow, statement } from "../../sql/statement";
import { dueIndexStatements } from "../dueIndex";
import {
  backoffDelayMs,
  backoffStatement,
  claimGuardStatement,
  claimStatement,
  completeStatement,
  dueCandidatesStatement,
  dueIndexRowsStatement,
  scheduleStatement,
  scopeTaskKey,
  selectDueRows,
  toScopeTask,
} from "../scheduledTasks";
import { SCHEDULED_TASKS_TABLE } from "../schema";
import { scopeColumns } from "../scopeName";

export type CloudflareScopeTaskSchedulerDeps = Readonly<{
  session: SqlSession;
  scope: ScopeKey;
  /** Global D1, which carries this scope's slice of the due index. */
  db: D1Database;
  logger?: Logger;
}>;

const CONTEXT = "scheduled_tasks";

/**
 * `ScopeTaskScheduler` over one scope object's `scheduled_tasks`.
 *
 * Every statement comes from `../scheduledTasks.ts`, which the object's
 * own `alarm()` turn also executes: selection, the claim predicate and
 * the backoff arithmetic are one spelling, not two.
 *
 * Each mutation carries the row image the write-set overlay serves back,
 * so a unit of work that schedules and then backs off the same row reads
 * its own writes. `backoff` and `backoffOrSchedule` read the row first
 * for that reason alone — the statements compute the next state in SQL
 * and need no prior read of their own.
 *
 * ## Fencing
 *
 * Settling addresses a row by `(kind, operationId)` and carries no claim
 * token, exactly as the port defines. What keeps that safe is that one
 * scope has one writer: either the object's own alarm turns, which are
 * serialised, or the central runner — never both, because the object
 * only drives tasks when the deployment registered handlers with it.
 * A deployment that puts a second writer on one scope leaves that
 * premise, and a settle from a writer whose lease has lapsed can then
 * undo a turn the new holder has already started. Claiming is exclusive
 * per row regardless, so a row offered to two runners still reaches only
 * one of them; the lease recovers a writer that disappeared.
 *
 * ## Due index
 *
 * `ScopeTaskQueue.listDue` reads the global mirror of this table
 * (`../dueIndex.ts`). Inside a unit of work the scope object republishes
 * the slice itself when the committed write-set names this table, so
 * nothing is needed here — and every caller that reaches this scheduler
 * through a unit of work, the central runner included, takes that path.
 * Built straight over a scope's session there is no write-set to commit
 * and no hook, so the slice is republished here, after the write has
 * landed. The alarm is deliberately **not** re-armed on
 * that path: arming belongs to the object, which does it for every
 * committed write-set and at the end of every turn, and arming from
 * here would let an alarm turn race the caller for the row it just
 * wrote.
 */
export function createCloudflareScopeTaskScheduler(
  deps: CloudflareScopeTaskSchedulerDeps,
): ScopeTaskScheduler {
  const { session, scope, db } = deps;
  const logger = deps.logger ?? ConsoleLogger;
  const columns = scopeColumns(scope);

  const publishDueIndex = async (): Promise<void> => {
    if (session.staged) {
      return;
    }
    const rows = await session.query(dueIndexRowsStatement());
    await createD1Executor(db).apply(dueIndexStatements(columns, rows));
  };

  const write = async (mutations: readonly RowMutation[]): Promise<void> => {
    try {
      await session.write(mutations);
    } catch (cause) {
      throwTranslated(CONTEXT, cause);
    }
    try {
      await publishDueIndex();
    } catch (cause) {
      // The scope-side write has landed, so reporting a failure here
      // would invite the caller to retry a settle that already took
      // effect. The index is derived data, not the authority, so drift
      // is tolerated: the object's next alarm turn rewrites the slice.
      logger.warn("scope task due index publish failed", { cause });
    }
  };

  const readRow = async (
    kind: string,
    operationId: string,
  ): Promise<SqlRow | null> => {
    try {
      return await session.readRow({
        table: SCHEDULED_TASKS_TABLE,
        key: scopeTaskKey(kind, operationId),
        statement: statement(
          `SELECT kind, operation_id, due_at, payload, attempts, last_error, priority, status, lease_expires_at
             FROM ${SCHEDULED_TASKS_TABLE} WHERE kind = ? AND operation_id = ?`,
          kind,
          operationId,
        ),
      });
    } catch (cause) {
      throwTranslated(CONTEXT, cause);
    }
  };

  // Deliberately unmerged with the overlay: a candidate has to be a row
  // that is committed and visible to every other writer, so a row this
  // very unit of work scheduled is not one, and one it has already
  // staged a claim for must not be selected twice.
  const queryCandidates = async (
    now: Date,
    limit: number,
  ): Promise<readonly SqlRow[]> => {
    try {
      return await session.query(dueCandidatesStatement(now, limit));
    } catch (cause) {
      throwTranslated(CONTEXT, cause);
    }
  };

  const backedOff = (row: SqlRow, now: Date): RowMutation =>
    upsert({
      table: SCHEDULED_TASKS_TABLE,
      key: scopeTaskKey(text(row, "kind"), text(row, "operation_id")),
      row: backedOffImage(row, now),
      statement: backoffStatement(
        text(row, "kind"),
        text(row, "operation_id"),
        now,
      ),
    });

  return {
    async schedule(input): Promise<void> {
      await write([
        upsert({
          table: SCHEDULED_TASKS_TABLE,
          key: scopeTaskKey(input.kind, input.operationId),
          row: pendingImage(input),
          statement: scheduleStatement(input),
        }),
      ]);
    },

    async claimDue({
      now,
      limit,
      leaseMs,
    }: ClaimDueScopeTasksArgs): Promise<readonly ScopeTask[]> {
      if (limit <= 0) {
        return [];
      }
      const candidates = await queryCandidates(now, limit);
      const selected = selectDueRows(candidates, limit);
      if (selected.length === 0) {
        return [];
      }
      const leaseExpiresAt = new Date(now.getTime() + leaseMs);
      // Guard ahead of each claim, so the writer that lost the race
      // aborts instead of walking away believing it holds the row. The
      // port budgets exactly that: offering one row to two runners costs
      // no more than the claim one of them loses.
      await write(
        selected.flatMap((row) => {
          const kind = text(row, "kind");
          const operationId = text(row, "operation_id");
          return [
            opaque(occGuard(claimGuardStatement(kind, operationId, now))),
            upsert({
              table: SCHEDULED_TASKS_TABLE,
              key: scopeTaskKey(kind, operationId),
              row: {
                ...row,
                status: "running",
                lease_expires_at: toTimestamp(leaseExpiresAt),
              },
              statement: claimStatement(kind, operationId, now, leaseExpiresAt),
            }),
          ];
        }),
      );
      return selected.map((row) => toScopeTask(row, leaseExpiresAt));
    },

    async complete(kind: string, operationId: string): Promise<void> {
      await write([
        remove({
          table: SCHEDULED_TASKS_TABLE,
          key: scopeTaskKey(kind, operationId),
          statement: completeStatement(kind, operationId),
        }),
      ]);
    },

    async backoff(kind: string, operationId: string, now: Date): Promise<void> {
      const row = await readRow(kind, operationId);
      if (row === null) {
        return;
      }
      await write([backedOff(row, now)]);
    },

    async backoffOrSchedule(input): Promise<void> {
      const existing = await readRow(input.kind, input.operationId);
      if (existing !== null) {
        await write([backedOff(existing, input.now)]);
        return;
      }
      // Minted at `now` and immediately backed off, so the first retry
      // waits one base delay rather than running straight away.
      const minted = pendingImage({ ...input, dueAt: input.now });
      await write([
        upsert({
          table: SCHEDULED_TASKS_TABLE,
          key: scopeTaskKey(input.kind, input.operationId),
          row: minted,
          statement: scheduleStatement({ ...input, dueAt: input.now }),
        }),
        backedOff(minted, input.now),
      ]);
    },
  };
}

const pendingImage = (
  input: Readonly<{
    kind: string;
    operationId: string;
    priority: ScopeTaskPriority;
    dueAt: Date;
    payload: ScopeTaskPayload;
  }>,
): SqlRow => ({
  kind: input.kind,
  operation_id: input.operationId,
  due_at: toTimestamp(input.dueAt),
  payload: toJson(input.payload),
  attempts: 0,
  last_error: null,
  priority: input.priority,
  status: "pending",
  lease_expires_at: null,
});

/**
 * The row `backoffStatement` leaves behind. It repeats that statement's
 * arithmetic because the overlay needs the resulting image, not because
 * the write needs a prior read: past the attempt ceiling the row parks as
 * `failed` keeping its `dueAt`, and a row already `failed` stays there
 * with its attempts still climbing.
 */
const backedOffImage = (row: SqlRow, now: Date): SqlRow => {
  const attempts = int(row, "attempts") + 1;
  return attempts >= SCOPE_TASK_MAX_ATTEMPTS
    ? { ...row, attempts, status: "failed", lease_expires_at: null }
    : {
        ...row,
        attempts,
        status: "pending",
        due_at: now.getTime() + backoffDelayMs(attempts),
        lease_expires_at: null,
      };
};
