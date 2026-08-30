export type DistributedOperationKind =
  | "noteMove"
  | "notePurge"
  | "workspaceDeletion"
  | "accountDeletion"
  | "membershipChange"
  | "nameChange"
  | "integrationDisconnect";

/** `completed` and `rejected` are the terminal states. */
export type DistributedOperationState = "running" | "completed" | "rejected";

export type DistributedOperationPayload = Readonly<Record<string, unknown>>;

export type DistributedOperation = Readonly<{
  id: string;
  kind: DistributedOperationKind;
  partitionKey: string;
  requestKey: string;
  state: DistributedOperationState;
  payload: DistributedOperationPayload;
  createdAt: Date;
  updatedAt: Date;
  terminalAt: Date | null;
}>;

/**
 * Control plane of the operations that span scopes (account deletion
 * today, note move later) — `distributed_operations` of
 * spec/database/index.md, on the partition key's shard.
 *
 * `beginOrResume` is the only way an operation comes into being, and it
 * is deliberately one-way: the same `requestKey` replays the same
 * operation, a different `requestKey` joins the one already running, and
 * only a partition whose operations are all terminal starts a new one.
 * `payload` fixes the state machine's input at creation and is **never**
 * rewritten by a resume, so a resumed run never re-reads user input that
 * may have changed (or, for deletion, PII that is already gone).
 *
 * `countTerminalSince` is a plain observation: it counts retained
 * terminal rows and knows neither a threshold nor a window. The business
 * rule that reads it lives in
 * `domain/identity/services/accountDeletionRetryPolicy.ts`, so admission
 * counts, decides, and only then creates — never creates and rolls back.
 *
 * Retention is the manifest's: a terminal row stays until the manifest
 * prune calls `deleteTerminal` in the same transaction that drops the
 * terminal header. `deleteTerminal` refuses an operation that is still
 * running (`ConflictError`) — the header and the control-plane row must
 * not leave each other behind — and is a no-op on an operation that is
 * already gone, so re-running the prune succeeds.
 *
 * `markState` records the state its caller decided on: the store is not
 * the state machine, so ordering the transitions belongs to the caller,
 * and `terminalAt` follows the state it is given. Marking `running`
 * reopens a terminal row, which is how a caller that replayed one by its
 * request key gets a row it can still close — a saga driven on a terminal
 * row has no way to record where it stopped. The partition's
 * one-live-operation rule stays the store's, so a reopen is refused with
 * `DISTRIBUTED_OPERATION_ALREADY_RUNNING` while any *other* operation of
 * the same kind and partition is running, and the caller reports that as
 * its own "already in progress".
 *
 * Error contract: `ConflictError` (`markState` on an unknown operation or
 * on a reopen the partition refuses, `deleteTerminal` on a non-terminal
 * one), `SystemError(DatabaseError)`.
 */
export interface DistributedOperationStore {
  beginOrResume(
    input: Readonly<{
      kind: DistributedOperationKind;
      partitionKey: string;
      requestKey: string;
      payload: DistributedOperationPayload;
    }>,
  ): Promise<Readonly<{ operation: DistributedOperation; resumed: boolean }>>;
  countTerminalSince(
    kind: DistributedOperationKind,
    partitionKey: string,
    since: Date,
  ): Promise<number>;
  markState(
    operationId: string,
    state: DistributedOperationState,
    at: Date,
  ): Promise<void>;
  findByOperationId(operationId: string): Promise<DistributedOperation | null>;
  deleteTerminal(operationId: string): Promise<void>;
}
