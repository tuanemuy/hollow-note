import type { UserId } from "@repo/core/domain/identity/valueObject";
import type { NoteId } from "@repo/core/domain/note/valueObject";
import type { WorkspaceId } from "@repo/core/domain/workspace/valueObject";

export type AccountDeletionManifestItem =
  | Readonly<{
      key: string;
      kind: "membership";
      workspaceId: WorkspaceId;
      edgeState: "active" | "removing" | "pending";
      membershipId: string | null;
      prepareCommandKey: string | null;
      prepareDispatchedAt: Date | null;
      prepareAckedAt: Date | null;
      releaseCommandKey: string | null;
      releaseDispatchedAt: Date | null;
      releaseAckedAt: Date | null;
      cleanupAckedAt: Date | null;
    }>
  | Readonly<{
      key: string;
      kind: "authorRoute";
      noteId: NoteId;
      routeVersion: number;
      localRedactionAckedAt: Date | null;
      publicRedactionAckedAt: Date | null;
    }>;

export type AccountDeletionAuthorRoute = Readonly<{
  noteId: NoteId;
  routeVersion: number;
}>;

export type AccountDeletionPhase =
  | "prepare"
  | "release"
  | "cleanup"
  | "redaction";

export type AccountDeletionAckPhase =
  | "prepare"
  | "release"
  | "cleanup"
  | "localRedaction"
  | "publicRedaction";

export type AccountDeletionReceipt =
  | "personalAbort"
  | "personalCleanup"
  | "authResidue"
  | "externalConnections"
  | "jobHistory"
  | "uniquenessRelease";

/**
 * Application orchestration port for account deletion, placed on the
 * UserId shard.
 *
 * Header state machine: `begin` (idempotent) opens a building manifest →
 * membership pages (`appendMembershipPage`, co-located
 * active / removing / pending edges in edge-key order, fixed pages of at
 * most 100) and author-route pages (`appendAuthorRoutePage`, idempotent
 * append advancing the header cursor in the same transaction) fix the
 * targets → `markBuilt` → dispatch phases → either `markCompleted` or,
 * after a prepare rejection, `beginRollback` → release →
 * `markRejected`. Both terminal transitions stamp `terminalAt` and a
 * `retainUntil` (120 days); terminal headers are reclaimed by the
 * generation/shard/run-scoped global maintenance lane via `pruneTerminal`
 * (keyset cursor, max 100 per pass).
 *
 * Items are unique per operation + kind + target id; the full set of
 * item acks plus the personal/global receipt set is the source of truth
 * for finalize / rollback (`allRequiredAcknowledged` /
 * `allRollbackReleased`). Each remote command claims a deterministic
 * command key and `dispatchedAt` via `claimPending` (max 100) before
 * sending. Prepare rejection releases everything prepare-*dispatched*
 * (not just acked); releasing an unacquired lock no-ops under the same
 * command key. Compaction (`compactItems`, 100 per pass) may only start
 * after every release ack.
 *
 * Error contract: `ConflictError` (state-machine violations),
 * `SystemError(DatabaseError)`.
 */
export interface AccountDeletionManifestStore {
  begin(operationId: string, userId: UserId): Promise<void>;
  appendMembershipPage(
    operationId: string,
    afterEdgeKey: string | null,
    limit: number,
  ): Promise<Readonly<{ count: number; nextCursor: string | null }>>;
  appendAuthorRoutePage(
    operationId: string,
    routes: readonly AccountDeletionAuthorRoute[],
    nextCursor: string | null,
  ): Promise<void>;
  markBuilt(operationId: string): Promise<void>;
  beginRollback(operationId: string): Promise<void>;
  claimPending(
    operationId: string,
    phase: AccountDeletionPhase,
    limit: number,
  ): Promise<readonly AccountDeletionManifestItem[]>;
  acknowledge(
    operationId: string,
    itemKeys: readonly string[],
    phase: AccountDeletionAckPhase,
  ): Promise<void>;
  acknowledgeReceipt(
    operationId: string,
    receipt: AccountDeletionReceipt,
  ): Promise<void>;
  allRollbackReleased(operationId: string): Promise<boolean>;
  allRequiredAcknowledged(operationId: string): Promise<boolean>;
  compactItems(
    operationId: string,
    limit: number,
  ): Promise<Readonly<{ removed: number; remaining: boolean }>>;
  markCompleted(
    operationId: string,
    terminalAt: Date,
    retainUntil: Date,
  ): Promise<void>;
  markRejected(
    operationId: string,
    terminalAt: Date,
    retainUntil: Date,
  ): Promise<void>;
  pruneTerminal(
    asOf: Date,
    cursor: string | null,
    limit: number,
  ): Promise<Readonly<{ removed: number; nextCursor: string | null }>>;
}
