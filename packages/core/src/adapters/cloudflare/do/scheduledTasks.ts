import {
  SCOPE_TASK_BACKOFF_BASE_MS,
  SCOPE_TASK_MAX_ATTEMPTS,
  SCOPE_TASK_MAX_BACKOFF_MS,
  type ScopeTask,
  type ScopeTaskPayload,
  type ScopeTaskPriority,
} from "../../../application/ports/scopeTaskScheduler";
import { compositeKey, int, json, text } from "../sql/row";
import { type SqlRow, type SqlStatement, statement } from "../sql/statement";
import { SCHEDULED_TASKS_TABLE } from "./schema";

/**
 * `scheduled_tasks` in SQL: the row shape, the selection rule, and the
 * statements that move a row between states.
 *
 * Two callers share this module and must not drift apart — the
 * `ScopeTaskScheduler` port implementation, which stages these
 * statements into a scope unit of work's write-set, and the object's own
 * `alarm()` turn, which executes them directly. Selection is one rule
 * (`ScopeTaskScheduler`'s JSDoc: reserve one slot per priority walking
 * ascending, then fill in `(priority, dueAt, kind, operationId)` order),
 * so it is expressed once here.
 *
 * The table is `spec/database/index.md#scheduled_tasks`; the state
 * transitions are the port's table of the same name.
 */

/** Overlay key of a row — the `(kind, operation_id)` primary key. */
export const scopeTaskKey = (kind: string, operationId: string): string =>
  compositeKey(kind, operationId);

const COLUMNS =
  "kind, operation_id, due_at, payload, attempts, last_error, priority, status, lease_expires_at";

/**
 * Rows eligible for a claim: `pending` and due, or `running` with a
 * lapsed lease. Both branches bind `now` once each, in that order.
 */
const CANDIDATE_PREDICATE =
  "((status = 'pending' AND due_at <= ?) OR (status = 'running' AND lease_expires_at <= ?))";

/**
 * Superset of what the selection rule can pick, ordered the way it
 * returns rows.
 *
 * `LIMIT n` alone is not enough: reservation may take the head of a
 * priority that sits far past the first `n` rows of the global order. The
 * window function bounds each priority to `n` rows instead, so the
 * result contains every row reservation or fill could reach while
 * staying `4 × n` at worst.
 */
export const dueCandidatesStatement = (
  now: Date,
  limit: number,
): SqlStatement =>
  statement(
    `SELECT ${COLUMNS} FROM (
       SELECT ${COLUMNS},
              ROW_NUMBER() OVER (PARTITION BY priority ORDER BY due_at, kind, operation_id) AS rn
         FROM ${SCHEDULED_TASKS_TABLE}
        WHERE ${CANDIDATE_PREDICATE}
     )
     WHERE rn <= ?
     ORDER BY priority, due_at, kind, operation_id`,
    now.getTime(),
    now.getTime(),
    limit,
  );

/** Rows of this scope that belong in the global due index (ADR 003). */
export const dueIndexRowsStatement = (): SqlStatement =>
  statement(
    `SELECT kind, operation_id, due_at, priority, lease_expires_at
       FROM ${SCHEDULED_TASKS_TABLE} WHERE status <> 'failed'`,
  );

/**
 * The two candidates for the next alarm: the earliest `due_at` among
 * `pending` rows and the earliest `lease_expires_at` among `running`
 * ones (`spec/platform/index.md`「Scope Alarm」手順 4). `null` when the
 * object has no task at all, which is the signal to delete the alarm.
 */
export const nextWakeAtStatement = (): SqlStatement =>
  statement(
    `SELECT MIN(at) AS at FROM (
       SELECT MIN(due_at) AS at FROM ${SCHEDULED_TASKS_TABLE} WHERE status = 'pending'
       UNION ALL
       SELECT MIN(lease_expires_at) AS at FROM ${SCHEDULED_TASKS_TABLE} WHERE status = 'running'
     )`,
  );

/**
 * Maps a row to the port's `ScopeTask`. `leaseExpiresAt` is passed in by
 * the claimer, because the row it selected was a *candidate* — it may
 * still be `pending`, whose lease column is null by construction.
 */
export const toScopeTask = (row: SqlRow, leaseExpiresAt: Date): ScopeTask => ({
  kind: text(row, "kind"),
  operationId: text(row, "operation_id"),
  priority: int(row, "priority") as ScopeTaskPriority,
  payload: json<ScopeTaskPayload>(row, "payload"),
  dueAt: new Date(int(row, "due_at")),
  leaseExpiresAt,
  attempt: int(row, "attempts"),
});

const compareRows = (a: SqlRow, b: SqlRow): number =>
  int(a, "priority") - int(b, "priority") ||
  int(a, "due_at") - int(b, "due_at") ||
  (text(a, "kind") < text(b, "kind")
    ? -1
    : text(a, "kind") > text(b, "kind")
      ? 1
      : 0) ||
  (text(a, "operation_id") < text(b, "operation_id")
    ? -1
    : text(a, "operation_id") > text(b, "operation_id")
      ? 1
      : 0);

/**
 * The selection rule itself, over rows already ordered by
 * `dueCandidatesStatement`. Reserving one slot per priority is a floor,
 * not a ceiling — a single priority takes the whole `limit` when no
 * other has candidates, and a `limit` below the number of candidate
 * priorities degrades to strict priority order.
 */
export function selectDueRows(
  candidates: readonly SqlRow[],
  limit: number,
): readonly SqlRow[] {
  if (limit <= 0) {
    return [];
  }
  const ordered = [...candidates].sort(compareRows);
  const selected = new Set<SqlRow>();
  let reservedPriority: number | null = null;
  for (const row of ordered) {
    if (selected.size >= limit) break;
    const priority = int(row, "priority");
    if (priority === reservedPriority) continue;
    reservedPriority = priority;
    selected.add(row);
  }
  for (const row of ordered) {
    if (selected.size >= limit) break;
    selected.add(row);
  }
  return ordered.filter((row) => selected.has(row));
}

/**
 * Conditional claim. The predicate repeats the candidate test, so of two
 * writers racing for the same row only the one whose test still holds
 * takes it — which is how a backend without interactive transactions
 * gets the port's per-row exclusivity. `due_at`, `attempts`, `priority`
 * and `payload` are untouched, so a reclaimed row keeps its place.
 */
export const claimStatement = (
  kind: string,
  operationId: string,
  now: Date,
  leaseExpiresAt: Date,
): SqlStatement =>
  statement(
    `UPDATE ${SCHEDULED_TASKS_TABLE}
        SET status = 'running', lease_expires_at = ?
      WHERE kind = ? AND operation_id = ? AND ${CANDIDATE_PREDICATE}`,
    leaseExpiresAt.getTime(),
    kind,
    operationId,
    now.getTime(),
    now.getTime(),
  );

export const scheduleStatement = (
  input: Readonly<{
    kind: string;
    operationId: string;
    priority: ScopeTaskPriority;
    dueAt: Date;
    payload: ScopeTaskPayload;
  }>,
): SqlStatement =>
  statement(
    `INSERT INTO ${SCHEDULED_TASKS_TABLE}
       (kind, operation_id, due_at, payload, attempts, last_error, priority, status, lease_expires_at)
     VALUES (?, ?, ?, ?, 0, NULL, ?, 'pending', NULL)
     ON CONFLICT (kind, operation_id) DO UPDATE SET
       due_at = excluded.due_at,
       payload = excluded.payload,
       attempts = 0,
       last_error = NULL,
       priority = excluded.priority,
       status = 'pending',
       lease_expires_at = NULL`,
    input.kind,
    input.operationId,
    input.dueAt.getTime(),
    JSON.stringify(input.payload),
    input.priority,
  );

export const completeStatement = (
  kind: string,
  operationId: string,
): SqlStatement =>
  statement(
    `DELETE FROM ${SCHEDULED_TASKS_TABLE} WHERE kind = ? AND operation_id = ?`,
    kind,
    operationId,
  );

export const backoffDelayMs = (attempt: number): number =>
  Math.min(
    SCOPE_TASK_BACKOFF_BASE_MS * 2 ** Math.max(attempt - 1, 0),
    SCOPE_TASK_MAX_BACKOFF_MS,
  );

/**
 * Backs a row off from whatever state it is in. The next `attempts` and
 * the state it implies are computed in SQL from the stored value, so the
 * statement needs no prior read: past the ceiling the row parks as
 * `failed`, and a row already `failed` stays `failed` with its
 * `attempts` still climbing.
 */
export const backoffStatement = (
  kind: string,
  operationId: string,
  now: Date,
): SqlStatement =>
  statement(
    `UPDATE ${SCHEDULED_TASKS_TABLE}
        SET attempts = attempts + 1,
            status = CASE WHEN attempts + 1 >= ${SCOPE_TASK_MAX_ATTEMPTS} THEN 'failed' ELSE 'pending' END,
            due_at = CASE
              WHEN attempts + 1 >= ${SCOPE_TASK_MAX_ATTEMPTS} THEN due_at
              ELSE ? + MIN(
                ${SCOPE_TASK_BACKOFF_BASE_MS} * (1 << MIN(attempts, 30)),
                ${SCOPE_TASK_MAX_BACKOFF_MS}
              )
            END,
            lease_expires_at = NULL
      WHERE kind = ? AND operation_id = ?`,
    now.getTime(),
    kind,
    operationId,
  );
