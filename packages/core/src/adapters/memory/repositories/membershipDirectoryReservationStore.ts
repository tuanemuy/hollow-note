import { ConflictError } from "../../../application/errors";
import type { UserId } from "../../../domain/identity/valueObject";
import type {
  ActivatingMembershipEdge,
  MembershipDirectoryReservationStore,
} from "../../../domain/workspace/ports/membershipDirectoryReservationStore";
import type { WorkspaceId } from "../../../domain/workspace/valueObject";
import type { MembershipDirectoryRow, MemoryBackend } from "../store";
import { compareStrings } from "../support";

const edgeConflict = (detail: string): ConflictError =>
  new ConflictError("MEMBERSHIP_EDGE_CONFLICT", detail);

const alreadyExists = (userId: UserId, workspaceId: string): ConflictError =>
  new ConflictError(
    "MEMBERSHIP_ALREADY_EXISTS",
    `User ${userId} already has an edge to workspace ${workspaceId}`,
  );

/** The later of the two instants — a lease never moves backwards. */
const laterOf = (stored: Date | null, next: Date): Date =>
  stored !== null && stored.getTime() > next.getTime() ? stored : next;

export function createMemoryMembershipDirectoryReservationStore(
  backend: MemoryBackend,
): MembershipDirectoryReservationStore {
  const table = backend.membershipEdges;

  const byEdgeKey = (
    edgeKey: string,
  ): readonly [string, MembershipDirectoryRow] | null =>
    table.entries().find(([, row]) => row.edgeKey === edgeKey) ?? null;

  const byPair = (
    userId: UserId,
    workspaceId: WorkspaceId,
  ): readonly [string, MembershipDirectoryRow] | null =>
    table
      .entries()
      .find(
        ([, row]) => row.userId === userId && row.workspaceId === workspaceId,
      ) ?? null;

  /**
   * Lock transitions share one shape: the edge must exist, and the lock
   * it carries must be this deletion's. Expiry is deliberately not part
   * of the test — a lapsed lease never transfers ownership.
   */
  const lockedRow = (
    edgeOperationId: string,
    deletionOperationId: string,
  ): readonly [string, MembershipDirectoryRow] | null => {
    const found = byEdgeKey(edgeOperationId);
    if (found === null) {
      return null;
    }
    const [, row] = found;
    if (row.deletionPrepareOperationId !== deletionOperationId) {
      throw edgeConflict(
        `Edge ${edgeOperationId} is not prepared by deletion ${deletionOperationId}`,
      );
    }
    return found;
  };

  return {
    async reserveAndClaimActivation(input): Promise<void> {
      const existing = byPair(input.userId, input.workspaceId);
      if (existing !== null) {
        const [key, row] = existing;
        if (row.edgeKey !== input.operationId) {
          throw alreadyExists(input.userId, input.workspaceId);
        }
        // The deletion decided about this edge already; the join loses.
        if (row.deletionPrepareOperationId !== null) {
          throw edgeConflict(
            `Edge ${input.operationId} is held by an account deletion`,
          );
        }
        if (row.edgeState === "pending") {
          table.set(key, { ...row, edgeState: "activating" });
          return;
        }
        if (row.edgeState === "activating" || row.edgeState === "active") {
          return;
        }
        throw edgeConflict(
          `Edge ${input.operationId} is ${row.edgeState} and cannot be claimed`,
        );
      }
      const user = backend.users.get(input.userId);
      if (user === undefined || user.status !== "active") {
        throw edgeConflict(`User ${input.userId} is not active`);
      }
      table.set(`${input.userId} ${input.operationId}`, {
        userId: input.userId,
        edgeKey: input.operationId,
        workspaceId: input.workspaceId,
        edgeState: "activating",
        membershipId: input.membershipId,
        role: input.role,
        roleSourceVersion: null,
        deletionPrepareOperationId: null,
        deletionPrepareExpiresAt: null,
        reservationExpiresAt: input.expiresAt,
        createdAt: backend.clock.now(),
      });
    },

    async activate(operationId: string): Promise<void> {
      const found = byEdgeKey(operationId);
      if (found === null) {
        throw edgeConflict(`Edge ${operationId} does not exist`);
      }
      const [key, row] = found;
      if (row.edgeState === "active") {
        return;
      }
      if (row.deletionPrepareOperationId !== null) {
        throw edgeConflict(
          `Edge ${operationId} is held by an account deletion`,
        );
      }
      // `pending` is reachable as well as `activating`: a deletion that
      // rolled back its prepare hands the edge back as `pending`, and the
      // join that reserved it may still settle.
      if (row.edgeState !== "pending" && row.edgeState !== "activating") {
        throw edgeConflict(
          `Edge ${operationId} is ${row.edgeState} and cannot be activated`,
        );
      }
      table.set(key, {
        ...row,
        edgeState: "active",
        reservationExpiresAt: null,
      });
    },

    async abandon(operationId: string): Promise<void> {
      const found = byEdgeKey(operationId);
      if (found === null) {
        return;
      }
      const [key, row] = found;
      if (row.edgeState !== "pending" && row.edgeState !== "activating") {
        return;
      }
      table.delete(key);
    },

    async prepareAccountDeletion(input): Promise<void> {
      const found = byEdgeKey(input.edgeOperationId);
      if (found === null) {
        throw edgeConflict(`Edge ${input.edgeOperationId} does not exist`);
      }
      const [key, row] = found;
      if (row.deletionPrepareOperationId !== null) {
        if (row.deletionPrepareOperationId !== input.deletionOperationId) {
          throw edgeConflict(
            `Edge ${input.edgeOperationId} is prepared by another deletion`,
          );
        }
        table.set(key, {
          ...row,
          deletionPrepareExpiresAt: laterOf(
            row.deletionPrepareExpiresAt,
            input.expiresAt,
          ),
        });
        return;
      }
      if (row.edgeState !== "pending") {
        throw edgeConflict(
          `Edge ${input.edgeOperationId} is ${row.edgeState}, not pending`,
        );
      }
      table.set(key, {
        ...row,
        deletionPrepareOperationId: input.deletionOperationId,
        deletionPrepareExpiresAt: input.expiresAt,
      });
    },

    async renewAccountDeletion(
      edgeOperationId: string,
      deletionOperationId: string,
      expiresAt: Date,
    ): Promise<void> {
      const found = lockedRow(edgeOperationId, deletionOperationId);
      if (found === null) {
        throw edgeConflict(`Edge ${edgeOperationId} does not exist`);
      }
      const [key, row] = found;
      table.set(key, {
        ...row,
        deletionPrepareExpiresAt: laterOf(
          row.deletionPrepareExpiresAt,
          expiresAt,
        ),
      });
    },

    async commitAccountDeletion(
      edgeOperationId: string,
      deletionOperationId: string,
    ): Promise<void> {
      const found = lockedRow(edgeOperationId, deletionOperationId);
      // The outcome a lost response wants — no edge — already holds.
      if (found === null) {
        return;
      }
      table.delete(found[0]);
    },

    async releaseAccountDeletion(
      edgeOperationId: string,
      deletionOperationId: string,
    ): Promise<void> {
      const found = byEdgeKey(edgeOperationId);
      if (found === null) {
        return;
      }
      const [key, row] = found;
      if (row.deletionPrepareOperationId === null) {
        return;
      }
      if (row.deletionPrepareOperationId !== deletionOperationId) {
        throw edgeConflict(
          `Edge ${edgeOperationId} is prepared by another deletion`,
        );
      }
      table.set(key, {
        ...row,
        deletionPrepareOperationId: null,
        deletionPrepareExpiresAt: null,
      });
    },

    async listActivatingByUser(
      userId: UserId,
      limit: number,
    ): Promise<readonly ActivatingMembershipEdge[]> {
      return table
        .values()
        .filter(
          (row) => row.userId === userId && row.edgeState === "activating",
        )
        .sort((a, b) => compareStrings(a.edgeKey, b.edgeKey))
        .slice(0, Math.max(0, limit))
        .map((row) => ({
          operationId: row.edgeKey,
          workspaceId: row.workspaceId,
        }));
    },

    async applyRoleIfNewer(input): Promise<void> {
      const found = byPair(input.userId, input.workspaceId);
      // An absent edge is never inserted: a removal already freed the
      // pair, and reviving it would put the workspace back in the list.
      if (found === null) {
        return;
      }
      const [key, row] = found;
      if (
        row.roleSourceVersion !== null &&
        row.roleSourceVersion >= input.sourceVersion
      ) {
        return;
      }
      table.set(key, {
        ...row,
        role: input.role,
        roleSourceVersion: input.sourceVersion,
      });
    },

    async beginRemoval(
      userId: UserId,
      workspaceId: WorkspaceId,
    ): Promise<void> {
      const found = byPair(userId, workspaceId);
      // No active edge is the outcome a removal wants; it already holds.
      if (found === null) {
        return;
      }
      const [key, row] = found;
      if (row.edgeState === "removing") {
        return;
      }
      // `activating` is taken too: the scope, not the join's claim, is the
      // authority on whether the membership exists.
      if (row.edgeState !== "active" && row.edgeState !== "activating") {
        throw edgeConflict(
          `Edge of user ${userId} in workspace ${workspaceId} is ${row.edgeState} and cannot be removed`,
        );
      }
      table.set(key, {
        ...row,
        edgeState: "removing",
        reservationExpiresAt: null,
      });
    },

    async abandonRemoval(
      userId: UserId,
      workspaceId: WorkspaceId,
    ): Promise<void> {
      const found = byPair(userId, workspaceId);
      // Nothing announced, or nothing left to restore.
      if (found === null) {
        return;
      }
      const [key, row] = found;
      if (row.edgeState === "active") {
        return;
      }
      if (row.edgeState !== "removing") {
        throw edgeConflict(
          `Edge of user ${userId} in workspace ${workspaceId} is ${row.edgeState}, not removing`,
        );
      }
      table.set(key, {
        ...row,
        edgeState: "active",
        reservationExpiresAt: null,
      });
    },

    async completeRemoval(
      userId: UserId,
      workspaceId: WorkspaceId,
    ): Promise<void> {
      const found = byPair(userId, workspaceId);
      if (found === null) {
        return;
      }
      const [key, row] = found;
      if (row.edgeState !== "removing") {
        throw edgeConflict(
          `Edge of user ${userId} in workspace ${workspaceId} is ${row.edgeState}, not removing`,
        );
      }
      table.delete(key);
    },
  };
}
