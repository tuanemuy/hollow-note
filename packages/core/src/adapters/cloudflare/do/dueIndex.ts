import { GLOBAL_TABLES } from "../d1/schema";
import { intOrNull, text } from "../sql/row";
import { type SqlRow, type SqlStatement, statement } from "../sql/statement";

const TABLE = GLOBAL_TABLES.scopeTaskDueIndex;

/**
 * The global mirror of one scope's `scheduled_tasks`
 * ([ADR 003](../../../../../.thread/11/adr.md)).
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
 * this is an ordering guarantee, not a shared commit. Drift left by a
 * crash between the two is healed by the object's next alarm, and a
 * stale row costs at most one failed claim, which the port's JSDoc
 * already budgets for.
 *
 * Replacing the whole slice — rather than mirroring each mutation — is
 * what makes the two paths that change tasks (a committed write-set and
 * an alarm turn's claims) converge on the same result without either
 * having to know which rows the other touched.
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
