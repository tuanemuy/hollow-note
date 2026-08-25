import type { ScopeTask } from "../../../application/ports/scopeTaskScheduler";
import type { ScopeKey } from "../../../application/scope";
import { intOrNull } from "../sql/row";
import type { SqlRow, SqlStatement } from "../sql/statement";
import {
  claimStatement,
  dueCandidatesStatement,
  nextWakeAtStatement,
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
 * remaining budget.
 *
 * A row whose `kind` has no handler is visited and deliberately **not**
 * settled: it stays `running` until its lease lapses, which surfaces the
 * gap as a stall instead of silently completing work nothing did.
 */
export type ScopeAlarmHandler = (
  task: ScopeTask,
  scope: ScopeKey,
) => Promise<void>;

const handlers = new Map<string, ScopeAlarmHandler>();

/**
 * Registers the handler for a continuation kind. The deployment's worker
 * entry populates the registry at module scope: the Durable Object
 * shares the worker's bundle, so a registration made when the module
 * loads is in place before any alarm fires. An empty registry is a valid
 * deployment — every row then takes the "no handler" path above.
 */
export function registerScopeTaskHandler(
  kind: string,
  handler: ScopeAlarmHandler,
): void {
  handlers.set(kind, handler);
}

export function scopeTaskHandlerFor(
  kind: string,
): ScopeAlarmHandler | undefined {
  return handlers.get(kind);
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
}>;

export type ScopeAlarmTurnResult = Readonly<{
  claimed: number;
  handled: number;
  unhandled: number;
}>;

export async function runScopeAlarmTurn(
  input: ScopeAlarmTurnInput,
): Promise<ScopeAlarmTurnResult> {
  const rowBudget = input.rowBudget ?? SCOPE_ALARM_ROW_BUDGET;
  const cpuBudgetMs = input.cpuBudgetMs ?? SCOPE_ALARM_CPU_BUDGET_MS;
  const started = Date.now();
  const elapsedMs = input.elapsedMs ?? (() => Date.now() - started);
  const leaseExpiresAt = new Date(input.now.getTime() + input.leaseMs);

  let remaining = rowBudget;
  let claimedCount = 0;
  let handled = 0;
  let unhandled = 0;

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

    for (const task of claimed) {
      const handle = handlers.get(task.kind);
      if (handle === undefined) {
        unhandled += 1;
        continue;
      }
      await handle(task, input.scope);
      handled += 1;
    }
  }

  return { claimed: claimedCount, handled, unhandled };
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

export async function rescheduleAlarm(
  storage: DurableObjectStorage,
): Promise<void> {
  const at = nextWakeAt(storage);
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
