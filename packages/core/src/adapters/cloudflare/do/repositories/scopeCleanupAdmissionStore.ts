import { ConflictError } from "../../../../application/errors";
import type { Clock } from "../../../../application/ports/clock";
import type {
  PersonalCleanupComponent,
  PersonalCleanupProgress,
  ScopeCleanupAdmissionStore,
} from "../../../../application/ports/scopeCleanupAdmissionStore";
import type { UserId } from "../../../../domain/identity/valueObject";
import {
  opaque,
  type RowMutation,
  remove,
  upsert,
} from "../../execution/writeSet";
import { throwTranslated } from "../../sql/errors";
import { occGuard } from "../../sql/occGuard";
import { json, text, toJson, toTimestamp } from "../../sql/row";
import type { SqlSession } from "../../sql/session";
import { type SqlRow, statement } from "../../sql/statement";
import { SCOPE_TABLES } from "../schema";

/**
 * Every component the enum knows. It is the **default** required set, not
 * the contract: a deployment that declares nothing must stall short of
 * completion rather than complete early ([ADR 039](../../../../../../spec/adr/039-cleanup-participants-declaration.md)).
 */
const ALL_COMPONENTS: readonly PersonalCleanupComponent[] = [
  "job",
  "note",
  "tag",
  "storage",
  "backup",
  "usage",
  "localProjection",
  "outbox",
];

/**
 * `applied_operations.kind` of the barrier receipt. The table carries two
 * ports told apart by the meaning of their key (ADR 045), and this value
 * is the whole of that separation: every statement here filters on it, so
 * an `AppliedOperationStore` row can never be mistaken for a receipt.
 */
const BARRIER_KIND = "accountDeletionBarrier";

const TABLE = SCOPE_TABLES.appliedOperations;

const CONTEXT = "applied_operations";

/** `result` of a barrier row (`spec/database/index.md#applied_operations`). */
type BarrierResult = Readonly<{
  state: "running" | "completed";
  userId: string;
  componentAcks: Readonly<Partial<Record<PersonalCleanupComponent, boolean>>>;
}>;

export type CloudflareScopeCleanupAdmissionDeps = Readonly<{
  session: SqlSession;
  clock: Clock;
  /**
   * Components the deployment declares. `undefined` falls back to the
   * whole enum, which stalls — the safe direction (ADR 039).
   */
  requiredComponents?: readonly PersonalCleanupComponent[] | undefined;
}>;

const barrierClosed = (): ConflictError =>
  new ConflictError(
    "ACCOUNT_DELETING",
    "The scope is closed for writes by an account deletion barrier",
  );

const foreignOperation = (operationId: string): ConflictError =>
  new ConflictError(
    "CLEANUP_OPERATION_MISMATCH",
    `Operation ${operationId} does not own this scope's cleanup`,
  );

/**
 * `ScopeCleanupAdmissionStore` over the scope object's
 * `applied_operations`, holding the single `accountDeletionBarrier`
 * receipt of a personal scope.
 *
 * Each mutation is decided from the row read a moment earlier — that read
 * is what gives the port its own error vocabulary (`ACCOUNT_DELETING`,
 * `CLEANUP_OPERATION_MISMATCH`, `CLEANUP_NOT_ACKNOWLEDGED`) instead of a
 * bare lost-update. The guard staged alongside is the backstop for the
 * window between the read and the commit: it repeats the condition the
 * decision rested on, so a racing writer's commit aborts rather than
 * overwrites.
 *
 * Acknowledgement is written with `json_set` rather than by rewriting the
 * blob, so two components acking at once commute — the row image staged
 * for read-your-writes is computed the same way.
 */
export function createCloudflareScopeCleanupAdmissionStore(
  deps: CloudflareScopeCleanupAdmissionDeps,
): ScopeCleanupAdmissionStore {
  const { session, clock } = deps;
  const requiredComponents = deps.requiredComponents ?? ALL_COMPONENTS;

  const receipt = async (): Promise<SqlRow | null> => {
    try {
      const rows = await session.readRows({
        table: TABLE,
        statement: statement(
          `SELECT operation_id, kind, result, applied_at, expires_at
             FROM ${TABLE} WHERE kind = ?`,
          BARRIER_KIND,
        ),
        keyOf: (row) => text(row, "operation_id"),
        matches: (row) => text(row, "kind") === BARRIER_KIND,
      });
      return rows[0] ?? null;
    } catch (cause) {
      throwTranslated(CONTEXT, cause);
    }
  };

  const write = async (mutations: readonly RowMutation[]): Promise<void> => {
    try {
      await session.write(mutations);
    } catch (cause) {
      throwTranslated(CONTEXT, cause);
    }
  };

  /** The receipt this operation owns while it is still running. */
  const requireOwner = async (
    operationId: string,
  ): Promise<Readonly<{ row: SqlRow; result: BarrierResult }>> => {
    const row = await receipt();
    if (row === null || text(row, "operation_id") !== operationId) {
      throw foreignOperation(operationId);
    }
    const result = json<BarrierResult>(row, "result");
    if (result.state !== "running") {
      throw foreignOperation(operationId);
    }
    return { row, result };
  };

  const completedFor = async (
    operationId: string,
  ): Promise<BarrierResult | null> => {
    const row = await receipt();
    if (row === null || text(row, "operation_id") !== operationId) {
      return null;
    }
    const result = json<BarrierResult>(row, "result");
    return result.state === "completed" ? result : null;
  };

  return {
    async assertWritable(): Promise<void> {
      if ((await receipt()) !== null) {
        throw barrierClosed();
      }
    },

    async assertActorWritable(_actorUserId: UserId): Promise<void> {
      // The membership removal prepare lock lives in
      // `membership_removal_locks` and is read through
      // `MembershipRemovalPreparationStore.hasConflict`, which the
      // Workspace write paths consult themselves. This store is the
      // personal scope's barrier and is not that lock's reader on either
      // backend — the reference backend answers the same here.
      if ((await receipt()) !== null) {
        throw barrierClosed();
      }
    },

    async beginPersonalAccountDeletion(
      operationId: string,
      userId: UserId,
    ): Promise<void> {
      const existing = await receipt();
      if (existing !== null) {
        if (text(existing, "operation_id") === operationId) {
          return;
        }
        throw new ConflictError(
          "ACCOUNT_DELETING",
          "Another deletion operation already holds the barrier",
        );
      }
      const result: BarrierResult = {
        state: "running",
        userId,
        componentAcks: {},
      };
      const appliedAt = toTimestamp(clock.now());
      await write([
        opaque(
          occGuard(
            statement(
              `SELECT 1 WHERE NOT EXISTS (
                 SELECT 1 FROM ${TABLE} WHERE kind = ?
               )`,
              BARRIER_KIND,
            ),
          ),
        ),
        upsert({
          table: TABLE,
          key: operationId,
          row: {
            operation_id: operationId,
            kind: BARRIER_KIND,
            result: toJson(result),
            applied_at: appliedAt,
            expires_at: null,
          },
          statement: statement(
            `INSERT INTO ${TABLE} (operation_id, kind, result, applied_at, expires_at)
             VALUES (?, ?, ?, ?, NULL)`,
            operationId,
            BARRIER_KIND,
            toJson(result),
            appliedAt,
          ),
        }),
      ]);
    },

    async abortPersonalAccountDeletion(operationId: string): Promise<void> {
      await requireOwner(operationId);
      await write([
        opaque(occGuard(runningReceiptStatement(operationId))),
        remove({
          table: TABLE,
          key: operationId,
          statement: statement(
            `DELETE FROM ${TABLE} WHERE operation_id = ? AND kind = ?`,
            operationId,
            BARRIER_KIND,
          ),
        }),
      ]);
    },

    async assertOwner(operationId: string): Promise<void> {
      await requireOwner(operationId);
    },

    async describePersonalCleanup(
      operationId: string,
    ): Promise<PersonalCleanupProgress | null> {
      const row = await receipt();
      if (row === null || text(row, "operation_id") !== operationId) {
        return null;
      }
      const result = json<BarrierResult>(row, "result");
      return { status: result.state, acknowledged: acknowledgedOf(result) };
    },

    async acknowledgePersonalComponent(
      operationId: string,
      component: PersonalCleanupComponent,
    ): Promise<void> {
      // A duplicate arriving after completion is expected inside the
      // retention window and must not walk the receipt back to running.
      if ((await completedFor(operationId)) !== null) {
        return;
      }
      const { row, result } = await requireOwner(operationId);
      if (result.componentAcks[component] === true) {
        return;
      }
      await write([
        opaque(occGuard(runningReceiptStatement(operationId))),
        upsert({
          table: TABLE,
          key: operationId,
          row: {
            ...row,
            result: toJson({
              ...result,
              componentAcks: { ...result.componentAcks, [component]: true },
            }),
          },
          statement: statement(
            `UPDATE ${TABLE}
                SET result = json_set(result, '$.componentAcks.' || ?, json('true'))
              WHERE operation_id = ? AND kind = ?`,
            component,
            operationId,
            BARRIER_KIND,
          ),
        }),
      ]);
    },

    async markCompleted(operationId: string, retainUntil: Date): Promise<void> {
      if ((await completedFor(operationId)) !== null) {
        return;
      }
      const { row, result } = await requireOwner(operationId);
      const missing = requiredComponents.filter(
        (component) => result.componentAcks[component] !== true,
      );
      if (missing.length > 0) {
        throw new ConflictError(
          "CLEANUP_NOT_ACKNOWLEDGED",
          `Components not acknowledged yet: ${missing.join(", ")}`,
        );
      }
      await write([
        opaque(occGuard(runningReceiptStatement(operationId))),
        upsert({
          table: TABLE,
          key: operationId,
          row: {
            ...row,
            result: toJson({ ...result, state: "completed" }),
            expires_at: toTimestamp(retainUntil),
          },
          statement: statement(
            `UPDATE ${TABLE}
                SET result = json_set(result, '$.state', 'completed'),
                    expires_at = ?
              WHERE operation_id = ? AND kind = ?`,
            toTimestamp(retainUntil),
            operationId,
            BARRIER_KIND,
          ),
        }),
      ]);
    },

    async pruneCompleted(asOf: Date, limit: number): Promise<number> {
      if (limit <= 0) {
        return 0;
      }
      const row = await receipt();
      if (row === null) {
        return 0;
      }
      const result = json<BarrierResult>(row, "result");
      const expiresAt = row.expires_at;
      // A running receipt has no expiry at all, which is what keeps the
      // pruner off it however far the clock moves.
      if (
        result.state !== "completed" ||
        typeof expiresAt !== "number" ||
        expiresAt > asOf.getTime()
      ) {
        return 0;
      }
      const operationId = text(row, "operation_id");
      await write([
        remove({
          table: TABLE,
          key: operationId,
          statement: statement(
            `DELETE FROM ${TABLE}
              WHERE operation_id = ? AND kind = ? AND expires_at <= ?`,
            operationId,
            BARRIER_KIND,
            asOf.getTime(),
          ),
        }),
      ]);
      return 1;
    },
  };
}

const runningReceiptStatement = (operationId: string) =>
  statement(
    `SELECT 1 FROM ${TABLE}
      WHERE operation_id = ? AND kind = ?
        AND json_extract(result, '$.state') = 'running'`,
    operationId,
    BARRIER_KIND,
  );

const acknowledgedOf = (
  result: BarrierResult,
): readonly PersonalCleanupComponent[] =>
  ALL_COMPONENTS.filter(
    (component) => result.componentAcks[component] === true,
  );
