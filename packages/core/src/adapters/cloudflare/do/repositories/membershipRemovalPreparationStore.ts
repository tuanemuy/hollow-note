import { ConflictError } from "../../../../application/errors";
import { UserId } from "../../../../domain/identity/valueObject";
import type { MembershipRemovalPreparationStore } from "../../../../domain/workspace/ports/membershipRemovalPreparationStore";
import {
  opaque,
  type RowMutation,
  remove,
  upsert,
} from "../../execution/writeSet";
import { databaseError } from "../../sql/errors";
import { occGuard } from "../../sql/occGuard";
import { dateOrNull, enumOf, int, text, toTimestamp } from "../../sql/row";
import type { SqlSession } from "../../sql/session";
import { type SqlRow, statement } from "../../sql/statement";
import { SCOPE_TABLES } from "../schema";

const TABLE = SCOPE_TABLES.membershipRemovalLocks;
const MEMBERSHIPS = SCOPE_TABLES.memberships;
const CONTEXT = "the membership removal preparation store";

const STATES = ["prepared", "committed"] as const;
type LockState = (typeof STATES)[number];

const lockConflict = (detail: string): ConflictError =>
  new ConflictError("MEMBERSHIP_REMOVAL_LOCK_CONFLICT", detail);

const versionMismatch = (userId: UserId): ConflictError =>
  new ConflictError(
    "OPTIMISTIC_LOCK_FAILURE",
    `Membership of ${userId} is not at the observed version`,
  );

/** The later of the two instants — a lease never moves backwards. */
const laterOf = (stored: Date | null, next: Date): Date =>
  stored !== null && stored.getTime() > next.getTime() ? stored : next;

type Lock = Readonly<{
  operationId: string;
  userId: UserId;
  state: LockState;
  expiresAt: Date | null;
  raw: SqlRow;
}>;

const toLock = (row: SqlRow): Lock => ({
  operationId: text(row, "operation_id"),
  userId: UserId.create(text(row, "user_id")),
  state: enumOf(row, "state", STATES),
  expiresAt: dateOrNull(row, "expires_at"),
  raw: row,
});

export type CloudflareMembershipRemovalPreparationDeps = Readonly<{
  session: SqlSession;
}>;

/**
 * `membership_removal_locks` of one workspace scope object.
 *
 * `user_id` carries a UNIQUE, so "at most one lock per user in a scope"
 * is the schema's job and a second deletion loses on the read that
 * precedes the write. Expiry is never part of any predicate here: a
 * lapsed `prepared` lease still holds the membership and still answers
 * `hasConflict`, which is the fail-safe rule the port contract states —
 * only `release` turns it false.
 */
export function createCloudflareMembershipRemovalPreparationStore(
  deps: CloudflareMembershipRemovalPreparationDeps,
): MembershipRemovalPreparationStore {
  const { session } = deps;

  const write = async (mutations: readonly RowMutation[]): Promise<void> => {
    try {
      await session.write(mutations);
    } catch (cause) {
      throw databaseError(CONTEXT, cause);
    }
  };

  const readLock = async (operationId: string): Promise<Lock | null> => {
    const row = await session.readRow({
      table: TABLE,
      key: operationId,
      statement: statement(
        `SELECT * FROM ${TABLE} WHERE operation_id = ?`,
        operationId,
      ),
    });
    return row === null ? null : toLock(row);
  };

  const requireLock = async (operationId: string): Promise<Lock> => {
    const lock = await readLock(operationId);
    if (lock === null) {
      throw lockConflict(`No removal lock for operation ${operationId}`);
    }
    return lock;
  };

  const locksOfUser = (userId: UserId): Promise<readonly SqlRow[]> =>
    session.readRows({
      table: TABLE,
      statement: statement(`SELECT * FROM ${TABLE} WHERE user_id = ?`, userId),
      keyOf: (row) => text(row, "operation_id"),
      matches: (row) => row.user_id === userId,
    });

  const extendLease = (lock: Lock, expiresAt: Date): RowMutation => {
    const next = toTimestamp(laterOf(lock.expiresAt, expiresAt));
    return upsert({
      table: TABLE,
      key: lock.operationId,
      row: { ...lock.raw, expires_at: next },
      statement: statement(
        `UPDATE ${TABLE} SET expires_at = ? WHERE operation_id = ? AND state = 'prepared'`,
        next,
        lock.operationId,
      ),
    });
  };

  const stateGuard = (operationId: string, state: LockState) =>
    opaque(
      occGuard(
        statement(
          `SELECT 1 FROM ${TABLE} WHERE operation_id = ? AND state = ?`,
          operationId,
          state,
        ),
      ),
    );

  return {
    async prepare(input): Promise<void> {
      const own = await readLock(input.operationId);
      if (own !== null) {
        if (own.userId !== input.userId) {
          throw lockConflict(
            `Operation ${input.operationId} already locks another membership`,
          );
        }
        if (own.state === "prepared") {
          await write([
            stateGuard(input.operationId, "prepared"),
            extendLease(own, input.expiresAt),
          ]);
        }
        return;
      }
      // Expiry is deliberately not consulted: a lapsed lease still holds
      // the membership, and only global recovery decides its fate.
      if ((await locksOfUser(input.userId)).length > 0) {
        throw lockConflict(
          `Membership of ${input.userId} is locked by another operation`,
        );
      }
      const memberships = await session.readRows({
        table: MEMBERSHIPS,
        statement: statement(
          `SELECT id, user_id, version FROM ${MEMBERSHIPS} WHERE user_id = ?`,
          input.userId,
        ),
        keyOf: (row) => text(row, "id"),
        matches: (row) => row.user_id === input.userId,
      });
      const membership = memberships[0];
      if (
        membership === undefined ||
        int(membership, "version") !== input.expectedMembershipVersion
      ) {
        throw versionMismatch(input.userId);
      }
      const row: SqlRow = {
        operation_id: input.operationId,
        user_id: input.userId,
        membership_id: text(membership, "id"),
        expected_membership_version: input.expectedMembershipVersion,
        state: "prepared",
        expires_at: toTimestamp(input.expiresAt),
      };
      await write([
        opaque(
          occGuard(
            statement(
              `SELECT 1 FROM ${MEMBERSHIPS} m
                WHERE m.user_id = ? AND m.version = ?
                  AND NOT EXISTS (SELECT 1 FROM ${TABLE} WHERE user_id = ?)`,
              input.userId,
              input.expectedMembershipVersion,
              input.userId,
            ),
          ),
        ),
        upsert({
          table: TABLE,
          key: input.operationId,
          row,
          statement: statement(
            `INSERT INTO ${TABLE}
               (operation_id, user_id, membership_id, expected_membership_version, state, expires_at)
             VALUES (?, ?, ?, ?, 'prepared', ?)`,
            input.operationId,
            input.userId,
            text(membership, "id"),
            input.expectedMembershipVersion,
            toTimestamp(input.expiresAt),
          ),
        }),
      ]);
    },

    async renew(operationId: string, expiresAt: Date): Promise<void> {
      const lock = await requireLock(operationId);
      // A renewal that raced the commit must not fail the recovery loop,
      // and a committed lock has no expiry to extend.
      if (lock.state === "committed") {
        return;
      }
      await write([
        stateGuard(operationId, "prepared"),
        extendLease(lock, expiresAt),
      ]);
    },

    async commit(operationId: string): Promise<void> {
      const lock = await requireLock(operationId);
      if (lock.state === "committed") {
        return;
      }
      await write([
        stateGuard(operationId, "prepared"),
        upsert({
          table: TABLE,
          key: operationId,
          row: { ...lock.raw, state: "committed", expires_at: null },
          statement: statement(
            `UPDATE ${TABLE} SET state = 'committed', expires_at = NULL WHERE operation_id = ?`,
            operationId,
          ),
        }),
      ]);
    },

    async release(operationId: string): Promise<void> {
      await write([
        remove({
          table: TABLE,
          key: operationId,
          statement: statement(
            `DELETE FROM ${TABLE} WHERE operation_id = ?`,
            operationId,
          ),
        }),
      ]);
    },

    async hasConflict(userId: UserId): Promise<boolean> {
      return (await locksOfUser(userId)).length > 0;
    },
  };
}
