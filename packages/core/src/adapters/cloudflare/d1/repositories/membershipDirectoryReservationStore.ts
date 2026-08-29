import { ConflictError } from "../../../../application/errors";
import type { Clock } from "../../../../application/ports/clock";
import type { UserId } from "../../../../domain/identity/valueObject";
import type {
  ActivatingMembershipEdge,
  MembershipDirectoryReservationStore,
} from "../../../../domain/workspace/ports/membershipDirectoryReservationStore";
import { WorkspaceId } from "../../../../domain/workspace/valueObject";
import {
  opaque,
  type RowMutation,
  remove,
  upsert,
} from "../../execution/writeSet";
import { classifySqlError, databaseError } from "../../sql/errors";
import { occGuard } from "../../sql/occGuard";
import {
  dateOrNull,
  enumOf,
  text,
  textOrNull,
  toTimestamp,
  toTimestampOrNull,
} from "../../sql/row";
import type { SqlSession } from "../../sql/session";
import { type SqlRow, statement } from "../../sql/statement";
import { GLOBAL_TABLES } from "../schema";

const TABLE = GLOBAL_TABLES.membershipDirectory;
const USERS = GLOBAL_TABLES.users;
const CONTEXT = "the membership directory reservation store";

const STATES = ["pending", "activating", "active", "removing"] as const;
type EdgeState = (typeof STATES)[number];

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

type Edge = Readonly<{
  operationId: string;
  workspaceId: WorkspaceId;
  state: EdgeState;
  deletionPrepareOperationId: string | null;
  deletionPrepareExpiresAt: Date | null;
  raw: SqlRow;
}>;

const toEdge = (row: SqlRow): Edge => ({
  operationId: text(row, "operation_id"),
  workspaceId: WorkspaceId.create(text(row, "workspace_id")),
  state: enumOf(row, "state", STATES),
  deletionPrepareOperationId: textOrNull(row, "deletion_prepare_operation_id"),
  deletionPrepareExpiresAt: dateOrNull(row, "deletion_prepare_expires_at"),
  raw: row,
});

export type D1MembershipDirectoryReservationStoreDeps = Readonly<{
  session: SqlSession;
  clock: Clock;
}>;

/**
 * The reservation side of `membership_directory` on global D1
 * (`spec/database/index.md#membership_directory`), bound to the UserId
 * shard the session opens.
 *
 * The edge key is `operation_id`, which is also the primary key, so every
 * operation-keyed method is a single-row read. The join's claim and the
 * account deletion's prepare lock are two columns of that one row, which
 * is what lets a single transaction decide between them: `activate`
 * refuses while `deletion_prepare_operation_id` is set, and only
 * `commitAccountDeletion` removes the edge.
 *
 * Leases are fail-safe. Expiry is never part of a lock's predicate, so a
 * lapsed prepare lease still belongs to its deletion; only the holder's
 * own renew / release / commit move it.
 */
export function createD1MembershipDirectoryReservationStore(
  deps: D1MembershipDirectoryReservationStoreDeps,
): MembershipDirectoryReservationStore {
  const { session, clock } = deps;

  const readByOperation = async (operationId: string): Promise<Edge | null> => {
    const row = await session.readRow({
      table: TABLE,
      key: operationId,
      statement: statement(
        `SELECT * FROM ${TABLE} WHERE operation_id = ?`,
        operationId,
      ),
    });
    return row === null ? null : toEdge(row);
  };

  const readByPair = async (
    userId: UserId,
    workspaceId: WorkspaceId,
  ): Promise<Edge | null> => {
    const rows = await session.readRows({
      table: TABLE,
      statement: statement(
        `SELECT * FROM ${TABLE} WHERE user_id = ? AND workspace_id = ?`,
        userId,
        workspaceId,
      ),
      keyOf: (row) => text(row, "operation_id"),
      matches: (row) =>
        row.user_id === userId && row.workspace_id === workspaceId,
    });
    const row = rows[0];
    return row === undefined ? null : toEdge(row);
  };

  const write = async (mutations: readonly RowMutation[]): Promise<void> => {
    try {
      await session.write(mutations);
    } catch (cause) {
      throw databaseError(CONTEXT, cause);
    }
  };

  const ownerGuard = (operationId: string, owner: string) =>
    opaque(
      occGuard(
        statement(
          `SELECT 1 FROM ${TABLE} WHERE operation_id = ? AND deletion_prepare_operation_id = ?`,
          operationId,
          owner,
        ),
      ),
    );

  /**
   * Lock transitions share one shape: the edge must exist, and the lock
   * it carries must be this deletion's. Expiry is deliberately not part
   * of the test — a lapsed lease never transfers ownership.
   */
  const lockedEdge = async (
    edgeOperationId: string,
    deletionOperationId: string,
  ): Promise<Edge | null> => {
    const edge = await readByOperation(edgeOperationId);
    if (edge === null) {
      return null;
    }
    if (edge.deletionPrepareOperationId !== deletionOperationId) {
      throw edgeConflict(
        `Edge ${edgeOperationId} is not prepared by deletion ${deletionOperationId}`,
      );
    }
    return edge;
  };

  const setLock = (
    edge: Edge,
    owner: string | null,
    expiresAt: Date | null,
  ): RowMutation =>
    upsert({
      table: TABLE,
      key: edge.operationId,
      row: {
        ...edge.raw,
        deletion_prepare_operation_id: owner,
        deletion_prepare_expires_at: toTimestampOrNull(expiresAt),
        updated_at: toTimestamp(clock.now()),
      },
      statement: statement(
        `UPDATE ${TABLE}
            SET deletion_prepare_operation_id = ?,
                deletion_prepare_expires_at = ?,
                updated_at = ?
          WHERE operation_id = ?`,
        owner,
        toTimestampOrNull(expiresAt),
        toTimestamp(clock.now()),
        edge.operationId,
      ),
    });

  return {
    async reserveAndClaimActivation(input): Promise<void> {
      const existing = await readByPair(input.userId, input.workspaceId);
      if (existing !== null) {
        if (existing.operationId !== input.operationId) {
          throw alreadyExists(input.userId, input.workspaceId);
        }
        // The deletion decided about this edge already; the join loses.
        if (existing.deletionPrepareOperationId !== null) {
          throw edgeConflict(
            `Edge ${input.operationId} is held by an account deletion`,
          );
        }
        if (existing.state === "pending") {
          await write([
            opaque(
              occGuard(
                statement(
                  `SELECT 1 FROM ${TABLE} WHERE operation_id = ? AND state = 'pending' AND deletion_prepare_operation_id IS NULL`,
                  input.operationId,
                ),
              ),
            ),
            upsert({
              table: TABLE,
              key: input.operationId,
              row: {
                ...existing.raw,
                state: "activating",
                updated_at: toTimestamp(clock.now()),
              },
              statement: statement(
                `UPDATE ${TABLE} SET state = 'activating', updated_at = ? WHERE operation_id = ? AND state = 'pending'`,
                toTimestamp(clock.now()),
                input.operationId,
              ),
            }),
          ]);
          return;
        }
        if (existing.state === "activating" || existing.state === "active") {
          return;
        }
        throw edgeConflict(
          `Edge ${input.operationId} is ${existing.state} and cannot be claimed`,
        );
      }
      const user = await session.readRow({
        table: USERS,
        key: input.userId,
        statement: statement(
          `SELECT status FROM ${USERS} WHERE id = ?`,
          input.userId,
        ),
      });
      if (user === null || user.status !== "active") {
        throw edgeConflict(`User ${input.userId} is not active`);
      }
      const now = toTimestamp(clock.now());
      const row: SqlRow = {
        operation_id: input.operationId,
        user_id: input.userId,
        workspace_id: input.workspaceId,
        membership_id: input.membershipId,
        role: input.role,
        state: "activating",
        deletion_prepare_operation_id: null,
        deletion_prepare_expires_at: null,
        reservation_expires_at: toTimestamp(input.expiresAt),
        created_at: now,
        updated_at: now,
      };
      try {
        // The insert and the Active-User check are one statement pair in
        // one write-set: a User that is deleting leaves no row at all, so
        // a join cannot slip an edge in behind a deletion's cursor.
        await session.write([
          opaque(
            occGuard(
              statement(
                `SELECT 1 FROM ${USERS} u
                  WHERE u.id = ? AND u.status = 'active'
                    AND NOT EXISTS (
                      SELECT 1 FROM ${TABLE} WHERE user_id = ? AND workspace_id = ?
                    )`,
                input.userId,
                input.userId,
                input.workspaceId,
              ),
            ),
          ),
          upsert({
            table: TABLE,
            key: input.operationId,
            row,
            statement: statement(
              `INSERT INTO ${TABLE}
                 (operation_id, user_id, workspace_id, membership_id, role, state,
                  deletion_prepare_operation_id, deletion_prepare_expires_at,
                  reservation_expires_at, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, 'activating', NULL, NULL, ?, ?, ?)`,
              input.operationId,
              input.userId,
              input.workspaceId,
              input.membershipId,
              input.role,
              toTimestamp(input.expiresAt),
              now,
              now,
            ),
          }),
        ]);
      } catch (cause) {
        const failure = classifySqlError(cause);
        if (failure === "unique" || failure === "occGuard") {
          throw alreadyExists(input.userId, input.workspaceId);
        }
        throw databaseError(CONTEXT, cause);
      }
    },

    async activate(operationId: string): Promise<void> {
      const edge = await readByOperation(operationId);
      if (edge === null) {
        throw edgeConflict(`Edge ${operationId} does not exist`);
      }
      if (edge.state === "active") {
        return;
      }
      if (edge.deletionPrepareOperationId !== null) {
        throw edgeConflict(
          `Edge ${operationId} is held by an account deletion`,
        );
      }
      // `pending` is reachable as well as `activating`: a deletion that
      // rolled back its prepare hands the edge back as `pending`, and the
      // join that reserved it may still settle.
      if (edge.state !== "pending" && edge.state !== "activating") {
        throw edgeConflict(
          `Edge ${operationId} is ${edge.state} and cannot be activated`,
        );
      }
      const now = toTimestamp(clock.now());
      await write([
        opaque(
          occGuard(
            statement(
              `SELECT 1 FROM ${TABLE}
                WHERE operation_id = ?
                  AND state IN ('pending', 'activating')
                  AND deletion_prepare_operation_id IS NULL`,
              operationId,
            ),
          ),
        ),
        upsert({
          table: TABLE,
          key: operationId,
          row: {
            ...edge.raw,
            state: "active",
            reservation_expires_at: null,
            updated_at: now,
          },
          statement: statement(
            `UPDATE ${TABLE}
                SET state = 'active', reservation_expires_at = NULL, updated_at = ?
              WHERE operation_id = ?`,
            now,
            operationId,
          ),
        }),
      ]);
    },

    async abandon(operationId: string): Promise<void> {
      const edge = await readByOperation(operationId);
      if (
        edge === null ||
        (edge.state !== "pending" && edge.state !== "activating")
      ) {
        return;
      }
      await write([
        remove({
          table: TABLE,
          key: operationId,
          statement: statement(
            `DELETE FROM ${TABLE} WHERE operation_id = ? AND state IN ('pending', 'activating')`,
            operationId,
          ),
        }),
      ]);
    },

    async prepareAccountDeletion(input): Promise<void> {
      const edge = await readByOperation(input.edgeOperationId);
      if (edge === null) {
        throw edgeConflict(`Edge ${input.edgeOperationId} does not exist`);
      }
      if (edge.deletionPrepareOperationId !== null) {
        if (edge.deletionPrepareOperationId !== input.deletionOperationId) {
          throw edgeConflict(
            `Edge ${input.edgeOperationId} is prepared by another deletion`,
          );
        }
        await write([
          ownerGuard(input.edgeOperationId, input.deletionOperationId),
          setLock(
            edge,
            input.deletionOperationId,
            laterOf(edge.deletionPrepareExpiresAt, input.expiresAt),
          ),
        ]);
        return;
      }
      if (edge.state !== "pending") {
        throw edgeConflict(
          `Edge ${input.edgeOperationId} is ${edge.state}, not pending`,
        );
      }
      await write([
        opaque(
          occGuard(
            statement(
              `SELECT 1 FROM ${TABLE}
                WHERE operation_id = ? AND state = 'pending'
                  AND deletion_prepare_operation_id IS NULL`,
              input.edgeOperationId,
            ),
          ),
        ),
        setLock(edge, input.deletionOperationId, input.expiresAt),
      ]);
    },

    async renewAccountDeletion(
      edgeOperationId: string,
      deletionOperationId: string,
      expiresAt: Date,
    ): Promise<void> {
      const edge = await lockedEdge(edgeOperationId, deletionOperationId);
      if (edge === null) {
        throw edgeConflict(`Edge ${edgeOperationId} does not exist`);
      }
      await write([
        ownerGuard(edgeOperationId, deletionOperationId),
        setLock(
          edge,
          deletionOperationId,
          laterOf(edge.deletionPrepareExpiresAt, expiresAt),
        ),
      ]);
    },

    async commitAccountDeletion(
      edgeOperationId: string,
      deletionOperationId: string,
    ): Promise<void> {
      const edge = await lockedEdge(edgeOperationId, deletionOperationId);
      // The outcome a lost response wants — no edge — already holds.
      if (edge === null) {
        return;
      }
      await write([
        remove({
          table: TABLE,
          key: edgeOperationId,
          statement: statement(
            `DELETE FROM ${TABLE} WHERE operation_id = ? AND deletion_prepare_operation_id = ?`,
            edgeOperationId,
            deletionOperationId,
          ),
        }),
      ]);
    },

    async releaseAccountDeletion(
      edgeOperationId: string,
      deletionOperationId: string,
    ): Promise<void> {
      const edge = await readByOperation(edgeOperationId);
      if (edge === null || edge.deletionPrepareOperationId === null) {
        return;
      }
      if (edge.deletionPrepareOperationId !== deletionOperationId) {
        throw edgeConflict(
          `Edge ${edgeOperationId} is prepared by another deletion`,
        );
      }
      await write([
        ownerGuard(edgeOperationId, deletionOperationId),
        setLock(edge, null, null),
      ]);
    },

    async listActivatingByUser(
      userId: UserId,
      limit: number,
    ): Promise<readonly ActivatingMembershipEdge[]> {
      const bounded = Math.max(0, Math.trunc(limit));
      if (bounded === 0) {
        return [];
      }
      const rows = await session.readRows({
        table: TABLE,
        statement: statement(
          `SELECT operation_id, user_id, workspace_id, state FROM ${TABLE}
             WHERE user_id = ? AND state = 'activating'
             ORDER BY operation_id LIMIT ?`,
          userId,
          bounded,
        ),
        keyOf: (row) => text(row, "operation_id"),
        matches: (row) => row.user_id === userId && row.state === "activating",
        compare: (a, b) =>
          text(a, "operation_id") < text(b, "operation_id") ? -1 : 1,
        limit: bounded,
      });
      return rows.map((row) => ({
        operationId: text(row, "operation_id"),
        workspaceId: WorkspaceId.create(text(row, "workspace_id")),
      }));
    },
  };
}
