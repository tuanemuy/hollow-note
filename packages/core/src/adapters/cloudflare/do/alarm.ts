import { ConsoleLogger, type Logger } from "../../../application/ports/logger";
import type { ScopeTask } from "../../../application/ports/scopeTaskScheduler";
import type { ScopeKey } from "../../../application/scope";
import { occGuard } from "../sql/occGuard";
import { intOrNull } from "../sql/row";
import type { SqlRow, SqlStatement } from "../sql/statement";
import {
  backoffStatement,
  claimGuardStatement,
  claimStatement,
  dueCandidatesStatement,
  nextWakeAtStatement,
  releaseStatement,
  selectDueRows,
  toScopeTask,
} from "./scheduledTasks";

/**
 * One scope object's alarm turn (`spec/platform/index.md`「Scope Alarm」).
 *
 * The turn walks `scheduled_tasks` in the priority-weighted round-robin
 * the `ScopeTaskScheduler` contract defines — one reserved slot per
 * priority before any priority takes a second — so a flood of low
 * priority work cannot starve security cleanup or lease reaping. It
 * stops at `rowBudget` rows or `cpuBudgetMs` of wall time, whichever
 * comes first, and **claims only what it will visit**: a row claimed and
 * left unvisited is invisible for the whole lease, which would turn one
 * over-eager claim into a delay of a full lease period. That is also why
 * claims are taken a chunk at a time rather than one batch of the whole
 * remaining budget, and why rows the budget cuts off are released rather
 * than left leased.
 *
 * A row whose `kind` has no handler is visited and deliberately **not**
 * settled: it stays `running` until its lease lapses, which surfaces the
 * gap as a stall instead of silently completing work nothing did. A row
 * whose handler throws is backed off here, because the turn is the only
 * writer in a position to do it — without that, a permanently failing
 * target is re-driven forever with its attempt count frozen at zero.
 */
export type ScopeAlarmHandler = (
  task: ScopeTask,
  scope: ScopeKey,
) => Promise<void>;

export type ScopeAlarmHandlers = ReadonlyMap<string, ScopeAlarmHandler>;

const handlers = new Map<string, ScopeAlarmHandler>();

/**
 * Registers the handler for a continuation kind and returns the undo.
 * The deployment's worker entry populates the registry at module scope:
 * the Durable Object shares the worker's bundle, so a registration made
 * when the module loads is in place before any alarm fires.
 */
export function registerScopeTaskHandler(
  kind: string,
  handler: ScopeAlarmHandler,
): () => void {
  handlers.set(kind, handler);
  return () => {
    if (handlers.get(kind) === handler) {
      handlers.delete(kind);
    }
  };
}

/**
 * Whether this deployment drives continuations from the scope object at
 * all.
 *
 * An empty registry is a deployment where the central runner
 * (`runDueScopeTasks` over `ScopeTaskQueue`) is the only writer of
 * `scheduled_tasks`. Such an object must neither claim rows nor arm an
 * alarm for them: claiming would hide rows behind a lease nothing in the
 * object is going to settle, and arming for a `due_at` already past
 * re-delivers the alarm immediately for a turn that does nothing. One
 * writer per scope is the premise the fencing decision rests on, so the
 * registry — not the wiring of the queue — is what decides which writer
 * it is.
 */
export function scopeAlarmDrivesTasks(): boolean {
  return handlers.size > 0;
}

/** Rows one turn takes on (`spec/platform/index.md` 実行予算と分割単位). */
export const SCOPE_ALARM_ROW_BUDGET = 100;
/** Wall-clock budget of one turn, well inside the 15-minute alarm cap. */
export const SCOPE_ALARM_CPU_BUDGET_MS = 2_000;
/** Rows claimed per round, so a turn cut short by CPU strands few. */
const CLAIM_CHUNK = 10;

export type ScopeAlarmTurnInput = Readonly<{
  storage: DurableObjectStorage;
  scope: ScopeKey;
  now: Date;
  leaseMs: number;
  rowBudget?: number;
  cpuBudgetMs?: number;
  elapsedMs?: () => number;
  /** Defaults to the module registry; an argument keeps turns testable. */
  handlers?: ScopeAlarmHandlers;
  logger?: Logger;
}>;

export type ScopeAlarmTurnResult = Readonly<{
  claimed: number;
  handled: number;
  unhandled: number;
  failed: number;
  released: number;
}>;

const EMPTY_TURN: ScopeAlarmTurnResult = {
  claimed: 0,
  handled: 0,
  unhandled: 0,
  failed: 0,
  released: 0,
};

export async function runScopeAlarmTurn(
  input: ScopeAlarmTurnInput,
): Promise<ScopeAlarmTurnResult> {
  const registry = input.handlers ?? handlers;
  if (registry.size === 0) {
    return EMPTY_TURN;
  }
  const logger = input.logger ?? ConsoleLogger;
  const rowBudget = input.rowBudget ?? SCOPE_ALARM_ROW_BUDGET;
  const cpuBudgetMs = input.cpuBudgetMs ?? SCOPE_ALARM_CPU_BUDGET_MS;
  const started = Date.now();
  const elapsedMs = input.elapsedMs ?? (() => Date.now() - started);
  const leaseExpiresAt = new Date(input.now.getTime() + input.leaseMs);

  let remaining = rowBudget;
  let claimedCount = 0;
  let handled = 0;
  let unhandled = 0;
  let failed = 0;
  let released = 0;

  while (remaining > 0 && elapsedMs() < cpuBudgetMs) {
    const chunk = Math.min(remaining, CLAIM_CHUNK);
    const candidates = exec(
      input.storage,
      dueCandidatesStatement(input.now, chunk),
    );
    const selected = selectDueRows(candidates, chunk);
    if (selected.length === 0) {
      break;
    }

    const claimed: ScopeTask[] = [];
    input.storage.transactionSync(() => {
      for (const row of selected) {
        const task = toScopeTask(row, leaseExpiresAt);
        exec(
          input.storage,
          occGuard(claimGuardStatement(task.kind, task.operationId, input.now)),
        );
        exec(
          input.storage,
          claimStatement(
            task.kind,
            task.operationId,
            input.now,
            leaseExpiresAt,
          ),
        );
        claimed.push(task);
      }
    });

    if (claimed.length === 0) {
      break;
    }
    claimedCount += claimed.length;
    remaining -= claimed.length;

    let index = 0;
    for (; index < claimed.length; index += 1) {
      const task = claimed[index] as ScopeTask;
      if (elapsedMs() >= cpuBudgetMs) {
        break;
      }
      const handle = registry.get(task.kind);
      if (handle === undefined) {
        unhandled += 1;
        continue;
      }
      try {
        await handle(task, input.scope);
        handled += 1;
      } catch (cause) {
        failed += 1;
        exec(
          input.storage,
          backoffStatement(task.kind, task.operationId, input.now),
        );
        logger.error("scope alarm handler failed", {
          kind: task.kind,
          operationId: task.operationId,
          attempt: task.attempt,
          cause,
        });
      }
    }
    if (index < claimed.length) {
      const stranded = claimed.slice(index);
      released += stranded.length;
      input.storage.transactionSync(() => {
        for (const task of stranded) {
          exec(input.storage, releaseStatement(task.kind, task.operationId));
        }
      });
      break;
    }
  }

  if (unhandled > 0) {
    logger.warn("scope alarm turn left rows with no handler running", {
      unhandled,
    });
  }
  return { claimed: claimedCount, handled, unhandled, failed, released };
}

/**
 * The next wake time: the smaller of the earliest pending `due_at` and
 * the earliest running `lease_expires_at`. `null` means the object has
 * no task left and the alarm is deleted rather than re-armed.
 */
export function nextWakeAt(storage: DurableObjectStorage): Date | null {
  const rows = exec(storage, nextWakeAtStatement());
  const first = rows[0];
  if (first === undefined) {
    return null;
  }
  const at = intOrNull(first, "at");
  return at === null ? null : new Date(at);
}

/**
 * Arms the object for its next turn, or drops the alarm when there is
 * nothing to wake for — including the case where this deployment has no
 * handler registry and therefore no turn to run.
 */
export async function rescheduleAlarm(
  storage: DurableObjectStorage,
): Promise<void> {
  const at = scopeAlarmDrivesTasks() ? nextWakeAt(storage) : null;
  if (at === null) {
    await storage.deleteAlarm();
    return;
  }
  await storage.setAlarm(at.getTime());
}

const exec = (
  storage: DurableObjectStorage,
  input: SqlStatement,
): readonly SqlRow[] =>
  storage.sql.exec(input.sql, ...input.params).toArray() as unknown as SqlRow[];
