import type { AppliedOperationStore } from "../../../../application/ports/appliedOperationStore";
import type { Clock } from "../../../../application/ports/clock";
import { type RowMutation, upsert } from "../../execution/writeSet";
import { throwTranslated } from "../../sql/errors";
import { toTimestamp } from "../../sql/row";
import type { SqlSession } from "../../sql/session";
import { statement } from "../../sql/statement";
import { SCOPE_TABLES } from "../schema";

const TABLE = SCOPE_TABLES.appliedOperations;

/**
 * Rows this port owns. `applied_operations` is shared with
 * `ScopeCleanupAdmissionStore`, which owns `kind = 'accountDeletionBarrier'`
 * (`spec/database/index.md#applied_operations`, ADR 045).
 */
const KIND = "command";

/** No value is returned to a retry today, so the `result` column — which
 * exists for commands that do return one — holds JSON `null`. */
const RESULT = "null";

const hex = (bytes: ArrayBuffer): string =>
  [...new Uint8Array(bytes)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

/**
 * The two-part key folded into the single `operation_id` primary key
 * (`spec/database/index.md`: 列は 2 つに分けず 1 つへ畳む). The digest is
 * what keeps a second command of the same operation from colliding with
 * the first while the table still has one key column, which it must
 * because the barrier receipts live in it too.
 */
const appliedOperationId = async (
  operationId: string,
  commandKey: string,
): Promise<string> =>
  hex(
    await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(`${operationId}:${commandKey}`),
    ),
  );

export type CloudflareAppliedOperationStoreDeps = Readonly<{
  session: SqlSession;
  clock: Clock;
}>;

export function createCloudflareAppliedOperationStore(
  deps: CloudflareAppliedOperationStoreDeps,
): AppliedOperationStore {
  const { session, clock } = deps;

  return {
    async markApplied(
      input: Readonly<{ operationId: string; commandKey: string }>,
    ): Promise<boolean> {
      const key = await appliedOperationId(input.operationId, input.commandKey);
      const existing = await session.readRow({
        table: TABLE,
        key,
        statement: statement(
          `SELECT operation_id, kind, result, applied_at, expires_at
             FROM ${TABLE} WHERE operation_id = ?`,
          key,
        ),
      });
      if (existing !== null) {
        return false;
      }
      const appliedAt = toTimestamp(clock.now());
      const mutation: RowMutation = upsert({
        table: TABLE,
        key,
        row: {
          operation_id: key,
          kind: KIND,
          result: RESULT,
          applied_at: appliedAt,
          expires_at: null,
        },
        // Plain INSERT, not `ON CONFLICT DO NOTHING`: two units that both
        // read no row must not both be told they were the first. The
        // primary key aborts the loser's whole commit, and its retry
        // reads the winner's row and answers `false`.
        statement: statement(
          `INSERT INTO ${TABLE} (operation_id, kind, result, applied_at, expires_at)
             VALUES (?, ?, ?, ?, NULL)`,
          key,
          KIND,
          RESULT,
          appliedAt,
        ),
      });
      try {
        await session.write([mutation]);
      } catch (cause) {
        throwTranslated(`${TABLE} row ${key}`, cause);
      }
      return true;
    },
  };
}
