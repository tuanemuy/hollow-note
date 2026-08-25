import { ConflictError } from "../../../../application/errors";
import type { Clock } from "../../../../application/ports/clock";
import type {
  DistributedOperation,
  DistributedOperationKind,
  DistributedOperationPayload,
  DistributedOperationState,
  DistributedOperationStore,
} from "../../../../application/ports/distributedOperationStore";
import type { IdGenerator } from "../../../../application/ports/idGenerator";
import { opaque, remove, upsert } from "../../execution/writeSet";
import { classifySqlError, databaseError } from "../../sql/errors";
import { occGuard } from "../../sql/occGuard";
import {
  date,
  dateOrNull,
  enumOf,
  int,
  json,
  text,
  toJson,
  toTimestamp,
} from "../../sql/row";
import type { SqlSession } from "../../sql/session";
import { type SqlRow, statement } from "../../sql/statement";
import { GLOBAL_TABLES } from "../schema";

const TABLE = GLOBAL_TABLES.distributedOperations;

const KINDS: readonly DistributedOperationKind[] = [
  "noteMove",
  "notePurge",
  "workspaceDeletion",
  "accountDeletion",
  "membershipChange",
  "nameChange",
  "integrationDisconnect",
];

const STATES: readonly DistributedOperationState[] = [
  "running",
  "completed",
  "rejected",
];

const TERMINAL_STATES: readonly DistributedOperationState[] = [
  "completed",
  "rejected",
];

const notFound = (operationId: string): ConflictError =>
  new ConflictError(
    "DISTRIBUTED_OPERATION_NOT_FOUND",
    `No distributed operation ${operationId}`,
  );

const toOperation = (row: SqlRow): DistributedOperation => ({
  id: text(row, "id"),
  kind: enumOf(row, "kind", KINDS),
  partitionKey: text(row, "partition_key"),
  requestKey: text(row, "request_key"),
  state: enumOf(row, "state", STATES),
  payload: json<DistributedOperationPayload>(row, "payload"),
  createdAt: date(row, "created_at"),
  updatedAt: date(row, "updated_at"),
  terminalAt: dateOrNull(row, "terminal_at"),
});

export type D1DistributedOperationStoreDeps = Readonly<{
  session: SqlSession;
  clock: Clock;
  idGenerator: IdGenerator;
}>;

/**
 * `distributed_operations` on global D1.
 *
 * `beginOrResume` is the only creating path and the partial unique index
 * `(kind, partition_key) WHERE state NOT IN ('completed','rejected')` is
 * what makes "one running operation per partition" true under
 * concurrency; the read-then-branch here decides *which* answer a caller
 * gets, and the guard in front of the insert turns a lost race into a
 * refused batch rather than a second running operation.
 */
export function createD1DistributedOperationStore(
  deps: D1DistributedOperationStoreDeps,
): DistributedOperationStore {
  const { session, clock, idGenerator } = deps;

  const readById = async (
    operationId: string,
  ): Promise<DistributedOperation | null> => {
    const row = await session.readRow({
      table: TABLE,
      key: operationId,
      statement: statement(`SELECT * FROM ${TABLE} WHERE id = ?`, operationId),
    });
    return row === null ? null : toOperation(row);
  };

  const inPartition = async (
    kind: DistributedOperationKind,
    partitionKey: string,
  ): Promise<readonly DistributedOperation[]> => {
    const rows = await session.readRows({
      table: TABLE,
      statement: statement(
        `SELECT * FROM ${TABLE} WHERE kind = ? AND partition_key = ?`,
        kind,
        partitionKey,
      ),
      keyOf: (row) => text(row, "id"),
      matches: (row) => row.kind === kind && row.partition_key === partitionKey,
    });
    return rows.map(toOperation);
  };

  return {
    async beginOrResume(input) {
      const siblings = await inPartition(input.kind, input.partitionKey);
      const sameRequest = siblings.find(
        (row) => row.requestKey === input.requestKey,
      );
      if (sameRequest !== undefined) {
        return { operation: sameRequest, resumed: true };
      }
      const running = siblings.find((row) => row.state === "running");
      if (running !== undefined) {
        return { operation: running, resumed: true };
      }

      const now = clock.now();
      const id = idGenerator.next();
      const payload = toJson(input.payload);
      const row: SqlRow = {
        id,
        kind: input.kind,
        partition_key: input.partitionKey,
        request_key: input.requestKey,
        state: "running",
        payload,
        attempts: 0,
        next_attempt_at: null,
        created_at: toTimestamp(now),
        updated_at: toTimestamp(now),
        terminal_at: null,
        expires_at: null,
      };
      try {
        await session.write([
          opaque(
            occGuard(
              statement(
                `SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM ${TABLE} WHERE kind = ? AND partition_key = ? AND state = 'running')`,
                input.kind,
                input.partitionKey,
              ),
            ),
          ),
          upsert({
            table: TABLE,
            key: id,
            row,
            statement: statement(
              `INSERT INTO ${TABLE}
                 (id, kind, partition_key, request_key, state, payload, attempts, next_attempt_at, created_at, updated_at, terminal_at, expires_at)
               VALUES (?, ?, ?, ?, 'running', ?, 0, NULL, ?, ?, NULL, NULL)`,
              id,
              input.kind,
              input.partitionKey,
              input.requestKey,
              payload,
              toTimestamp(now),
              toTimestamp(now),
            ),
          }),
        ]);
      } catch (cause) {
        const failure = classifySqlError(cause);
        if (failure === "occGuard" || failure === "unique") {
          throw new ConflictError(
            "DISTRIBUTED_OPERATION_ALREADY_RUNNING",
            `Partition ${input.partitionKey} already has a running ${input.kind} operation`,
          );
        }
        throw databaseError("the distributed operation store", cause);
      }
      return { operation: toOperation(row), resumed: false };
    },

    async countTerminalSince(
      kind: DistributedOperationKind,
      partitionKey: string,
      since: Date,
    ): Promise<number> {
      const rows = await session.query(
        statement(
          `SELECT COUNT(*) AS terminal_count FROM ${TABLE}
             WHERE kind = ? AND partition_key = ? AND terminal_at IS NOT NULL AND terminal_at >= ?`,
          kind,
          partitionKey,
          toTimestamp(since),
        ),
      );
      const row = rows[0];
      return row === undefined ? 0 : int(row, "terminal_count");
    },

    async markState(
      operationId: string,
      state: DistributedOperationState,
      at: Date,
    ): Promise<void> {
      const row = await session.readRow({
        table: TABLE,
        key: operationId,
        statement: statement(
          `SELECT * FROM ${TABLE} WHERE id = ?`,
          operationId,
        ),
      });
      if (row === null) {
        throw notFound(operationId);
      }
      const terminalAt = TERMINAL_STATES.includes(state)
        ? toTimestamp(at)
        : null;
      try {
        await session.write([
          upsert({
            table: TABLE,
            key: operationId,
            row: {
              ...row,
              state,
              updated_at: toTimestamp(at),
              terminal_at: terminalAt,
            },
            statement: statement(
              `UPDATE ${TABLE} SET state = ?, updated_at = ?, terminal_at = ? WHERE id = ?`,
              state,
              toTimestamp(at),
              terminalAt,
              operationId,
            ),
          }),
        ]);
      } catch (cause) {
        throw databaseError("the distributed operation store", cause);
      }
    },

    findByOperationId(
      operationId: string,
    ): Promise<DistributedOperation | null> {
      return readById(operationId);
    },

    async deleteTerminal(operationId: string): Promise<void> {
      const operation = await readById(operationId);
      if (operation === null) {
        return;
      }
      if (operation.terminalAt === null) {
        throw new ConflictError(
          "DISTRIBUTED_OPERATION_NOT_TERMINAL",
          `Operation ${operationId} is still running`,
        );
      }
      try {
        await session.write([
          opaque(
            occGuard(
              statement(
                `SELECT 1 FROM ${TABLE} WHERE id = ? AND terminal_at IS NOT NULL`,
                operationId,
              ),
            ),
          ),
          remove({
            table: TABLE,
            key: operationId,
            statement: statement(
              `DELETE FROM ${TABLE} WHERE id = ? AND terminal_at IS NOT NULL`,
              operationId,
            ),
          }),
        ]);
      } catch (cause) {
        if (classifySqlError(cause) === "occGuard") {
          throw new ConflictError(
            "DISTRIBUTED_OPERATION_NOT_TERMINAL",
            `Operation ${operationId} is still running`,
          );
        }
        throw databaseError("the distributed operation store", cause);
      }
    },
  };
}
