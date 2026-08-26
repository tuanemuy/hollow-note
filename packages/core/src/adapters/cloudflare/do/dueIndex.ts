import { GLOBAL_TABLES } from "../d1/schema";
import { intOrNull, text } from "../sql/row";
import { type SqlRow, type SqlStatement, statement } from "../sql/statement";

const TABLE = GLOBAL_TABLES.scopeTaskDueIndex;

/**
 * How long a scope object waits before republishing a slice whose publish
 * failed. Short enough that a transient D1 fault does not strand a
 * continuation for long, long enough that an outage lasting minutes costs
 * a scope a handful of retries rather than a spin.
 */
export const DUE_INDEX_REPUBLISH_DELAY_MS = 10_000;

/**
 * The global mirror of one scope's `scheduled_tasks`
 * (`spec/database/index.md#scope_task_due_index`).
 *
 * `ScopeTaskQueue.listDue` has to span every scope, and Durable Objects
 * cannot be enumerated — `listDurableObjectIds` is a test helper, and
 * `spec/platform/index.md`「Global Cron」forbids enumerating scope
 * objects anyway. The authoritative rows stay in the object; this table
 * only answers "which scope has work".
 *
 * The scope object rewrites its own slice inside the same call that
 * commits a write-set touching `scheduled_tasks`, before that call
 * returns — so a task scheduled by a unit of work is listed by the time
 * `run` resolves. D1 and the object are **not** in one transaction
 * (`spec/database/index.md`: D1 と scope DO を 1 transaction に含めない);
 * this is an ordering guarantee, not a shared commit. A publish that
 * fails is tolerated rather than reported, because the write it follows
 * has already landed.
 *
 * The two directions of the drift that leaves are not symmetric. A row
 * this table still carries after the object dropped it costs at most one
 * failed claim, which the port's JSDoc already budgets for. A row that
 * never landed here is invisible to `ScopeTaskQueue.listDue`, which reads
 * nothing else — so nothing would come looking for that scope again. The
 * object therefore arms itself for `DUE_INDEX_REPUBLISH_DELAY_MS` when a
 * publish fails, and the turn that follows republishes the slice on its
 * way out. That retry does not depend on the deployment driving tasks
 * from the object: a turn with no handler registry does nothing and still
 * republishes. Nothing takes the retry away either — a rebuilt object and
 * a later commit both only arm, so an eviction, the next stray read and
 * an intervening write-set all leave it standing.
 *
 * Replacing the whole slice — rather than mirroring each mutation — is
 * what makes the two paths that change tasks (a committed write-set and
 * an alarm turn's claims) converge on the same result without either
 * having to know which rows the other touched. Convergence is an ordering
 * property, so the object serializes its publishes — the read of
 * `scheduled_tasks` included — against one another; two that overlap
 * across the D1 round trip would otherwise let the older slice land last
 * and drop the rows the newer one carried. The slice is bounded by
 * `dueIndexRowsStatement`, so both the row count and the JSON binding
 * this folds it into stay independent of how much work a scope holds.
 *
 * The rows carry the bare `ScopeKey`, not the object's test namespace
 * prefix — the columns exist to address a scope from a central runner,
 * and a prefix would leak into production data. Two objects that share a
 * `ScopeKey` under different namespaces therefore share one slice, which
 * is the one place the per-factory isolation of `./scopeName.ts` does
 * not reach. Tests that drive scope tasks through a unit of work must
 * not share a file with other scope-task tests.
 */
export function dueIndexStatements(
  scope: Readonly<{ type: string; id: string }>,
  rows: readonly SqlRow[],
): readonly SqlStatement[] {
  const clear = statement(
    `DELETE FROM ${TABLE} WHERE scope_type = ? AND scope_id = ?`,
    scope.type,
    scope.id,
  );
  if (rows.length === 0) {
    return [clear];
  }
  const payload = rows.map((row) => ({
    kind: text(row, "kind"),
    operation_id: text(row, "operation_id"),
    due_at: intOrNull(row, "due_at"),
    priority: intOrNull(row, "priority"),
    lease_expires_at: intOrNull(row, "lease_expires_at"),
  }));
  const insert = statement(
    `INSERT INTO ${TABLE}
       (scope_type, scope_id, kind, operation_id, due_at, priority, lease_expires_at)
     SELECT ?, ?,
            json_extract(value, '$.kind'),
            json_extract(value, '$.operation_id'),
            json_extract(value, '$.due_at'),
            json_extract(value, '$.priority'),
            json_extract(value, '$.lease_expires_at')
       FROM json_each(?)`,
    scope.type,
    scope.id,
    JSON.stringify(payload),
  );
  return [clear, insert];
}
