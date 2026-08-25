import type {
  DueScopeTask,
  ScopeTaskQueue,
} from "../../application/ports/scopeTaskQueue";
import { GLOBAL_TABLES } from "./d1/schema";
import { selectDueRows } from "./do/scheduledTasks";
import { scopeFromColumns } from "./do/scopeName";
import { text } from "./sql/row";
import type { SqlSession } from "./sql/session";
import { statement } from "./sql/statement";

const TABLE = GLOBAL_TABLES.scopeTaskDueIndex;

const COLUMNS = "scope_type, scope_id, kind, operation_id, due_at, priority";

/**
 * Candidate rows, in the encoding `../do/dueIndex.ts` writes: a `pending`
 * task has no lease and is due at `due_at`, a `running` one is due again
 * once its lease lapses. `failed` rows never reach the index at all.
 */
const CANDIDATE_PREDICATE =
  "((lease_expires_at IS NULL AND due_at <= ?) OR (lease_expires_at IS NOT NULL AND lease_expires_at <= ?))";

/**
 * The scope-spanning due read, over the global mirror of every scope's
 * `scheduled_tasks` ([ADR 003](../../../../.thread/11/adr.md)).
 *
 * Durable Objects cannot be enumerated, so this is the only way a central
 * runner learns which scopes have work — the port is explicit that a
 * backend answering with an empty array has not implemented it. The
 * runner still claims inside each scope's own unit of work, so this read
 * takes no lease and a row offered to two runners costs one lost claim.
 *
 * Selection is `ScopeTaskScheduler`'s rule applied across scopes rather
 * than within one, so it reuses the same function. Which scope carries a
 * reserved priority follows from `(dueAt, kind, operationId)`, which is
 * not a total order across scopes; ties are broken by scope here so the
 * result is at least stable, and the port leaves that choice open.
 */
export function createCloudflareScopeTaskQueue(
  deps: Readonly<{ session: SqlSession }>,
): ScopeTaskQueue {
  return {
    async listDue(now: Date, limit: number): Promise<readonly DueScopeTask[]> {
      if (limit <= 0) {
        return [];
      }
      const nowMs = now.getTime();
      // `LIMIT limit` alone would miss the head of a priority that sits
      // past the first `limit` rows of the global order, which is exactly
      // what reservation has to reach. Bounding each priority to `limit`
      // rows keeps the candidate set at `4 × limit` at worst.
      const candidates = await deps.session.query(
        statement(
          `SELECT ${COLUMNS} FROM (
             SELECT ${COLUMNS},
                    ROW_NUMBER() OVER (
                      PARTITION BY priority
                      ORDER BY due_at, kind, operation_id, scope_type, scope_id
                    ) AS rn
               FROM ${TABLE}
              WHERE ${CANDIDATE_PREDICATE}
           )
           WHERE rn <= ?
           ORDER BY priority, due_at, kind, operation_id, scope_type, scope_id`,
          nowMs,
          nowMs,
          limit,
        ),
      );
      return selectDueRows(candidates, limit).map((row) => ({
        scope: scopeFromColumns(text(row, "scope_type"), text(row, "scope_id")),
        kind: text(row, "kind"),
        operationId: text(row, "operation_id"),
      }));
    },
  };
}
