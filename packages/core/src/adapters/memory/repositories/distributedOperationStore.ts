import { ConflictError } from "../../../application/errors";
import type {
  DistributedOperation,
  DistributedOperationKind,
  DistributedOperationState,
  DistributedOperationStore,
} from "../../../application/ports/distributedOperationStore";
import type { MemoryBackend } from "../store";
import { clone } from "../support";

const TERMINAL_STATES: readonly DistributedOperationState[] = [
  "completed",
  "rejected",
];

const notFound = (operationId: string): ConflictError =>
  new ConflictError(
    "DISTRIBUTED_OPERATION_NOT_FOUND",
    `No distributed operation ${operationId}`,
  );

const alreadyRunning = (
  kind: DistributedOperationKind,
  partitionKey: string,
): ConflictError =>
  new ConflictError(
    "DISTRIBUTED_OPERATION_ALREADY_RUNNING",
    `Partition ${partitionKey} already has a running ${kind} operation`,
  );

export function createMemoryDistributedOperationStore(
  backend: MemoryBackend,
): DistributedOperationStore {
  const table = backend.distributedOperations;

  const inPartition = (
    kind: DistributedOperationKind,
    partitionKey: string,
  ): readonly DistributedOperation[] =>
    table
      .values()
      .filter((row) => row.kind === kind && row.partitionKey === partitionKey);

  return {
    async beginOrResume(input) {
      const siblings = inPartition(input.kind, input.partitionKey);
      const sameRequest = siblings.find(
        (row) => row.requestKey === input.requestKey,
      );
      if (sameRequest !== undefined) {
        return { operation: clone(sameRequest), resumed: true };
      }
      // `UNIQUE(partition_key) WHERE state NOT IN ('completed','rejected')`:
      // a second request joins the operation already in flight.
      const running = siblings.find((row) => row.state === "running");
      if (running !== undefined) {
        return { operation: clone(running), resumed: true };
      }

      const now = backend.clock.now();
      const operation: DistributedOperation = {
        id: backend.idGenerator.next(),
        kind: input.kind,
        partitionKey: input.partitionKey,
        requestKey: input.requestKey,
        state: "running",
        payload: clone(input.payload),
        createdAt: now,
        updatedAt: now,
        terminalAt: null,
      };
      table.set(operation.id, operation);
      return { operation: clone(operation), resumed: false };
    },

    async countTerminalSince(
      kind: DistributedOperationKind,
      partitionKey: string,
      since: Date,
    ): Promise<number> {
      return inPartition(kind, partitionKey).filter(
        (row) =>
          row.terminalAt !== null &&
          row.terminalAt.getTime() >= since.getTime(),
      ).length;
    },

    async markState(
      operationId: string,
      state: DistributedOperationState,
      at: Date,
    ): Promise<void> {
      const row = table.get(operationId);
      if (row === undefined) {
        throw notFound(operationId);
      }
      // The same partial unique index that stops `beginOrResume` from
      // opening a second operation: reopening a terminal row is the other
      // way into `state = 'running'`, and it has to answer to it too.
      if (
        state === "running" &&
        row.state !== "running" &&
        inPartition(row.kind, row.partitionKey).some(
          (sibling) => sibling.id !== row.id && sibling.state === "running",
        )
      ) {
        throw alreadyRunning(row.kind, row.partitionKey);
      }
      table.set(operationId, {
        ...row,
        state,
        updatedAt: at,
        terminalAt: TERMINAL_STATES.includes(state) ? at : null,
      });
    },

    async findByOperationId(
      operationId: string,
    ): Promise<DistributedOperation | null> {
      const row = table.get(operationId);
      return row === undefined ? null : clone(row);
    },

    async deleteTerminal(operationId: string): Promise<void> {
      const row = table.get(operationId);
      if (row === undefined) {
        return;
      }
      if (row.terminalAt === null) {
        throw new ConflictError(
          "DISTRIBUTED_OPERATION_NOT_TERMINAL",
          `Operation ${operationId} is still running`,
        );
      }
      table.delete(operationId);
    },
  };
}
