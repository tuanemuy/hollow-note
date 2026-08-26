import { ConflictError } from "../../../../application/errors";
import type { Clock } from "../../../../application/ports/clock";
import type { IdGenerator } from "../../../../application/ports/idGenerator";
import type {
  ActiveUniqueClaim,
  IdentityUniqueDirectory,
  IdentityUniqueKind,
} from "../../../../domain/identity/ports/identityUniqueDirectory";
import { UserId } from "../../../../domain/identity/valueObject";
import { opaque, remove, upsert } from "../../execution/writeSet";
import {
  classifySqlError,
  databaseError,
  throwTranslated,
} from "../../sql/errors";
import { occGuard } from "../../sql/occGuard";
import {
  compositeKey,
  dateOrNull,
  enumOf,
  intOrNull,
  text,
  toTimestamp,
} from "../../sql/row";
import type { SqlSession } from "../../sql/session";
import { type SqlRow, statement } from "../../sql/statement";
import { GLOBAL_TABLES } from "../schema";

const TABLE = GLOBAL_TABLES.identityUniqueReservations;
const USERS = GLOBAL_TABLES.users;

const CONFLICT_CODES: Record<IdentityUniqueKind, string> = {
  email: "EMAIL_ALREADY_USED",
  handle: "HANDLE_ALREADY_USED",
  providerAccount: "PROVIDER_ACCOUNT_ALREADY_LINKED",
};

const STATES = ["reserved", "active", "releasing"] as const;
type ReservationState = (typeof STATES)[number];

const KINDS: readonly IdentityUniqueKind[] = [
  "email",
  "handle",
  "providerAccount",
];

const rowKey = (kind: IdentityUniqueKind, normalizedKey: string): string =>
  compositeKey(kind, normalizedKey);

const heldByAnother = (
  kind: IdentityUniqueKind,
  normalizedKey: string,
): ConflictError =>
  new ConflictError(
    CONFLICT_CODES[kind],
    `Unique key already held: ${kind} ${normalizedKey}`,
  );

type Reservation = Readonly<{
  kind: IdentityUniqueKind;
  normalizedKey: string;
  userId: UserId;
  operationId: string;
  claimToken: string;
  state: ReservationState;
  expiresAt: Date | null;
  userVersion: number | null;
  raw: SqlRow;
}>;

const toReservation = (row: SqlRow): Reservation => ({
  kind: enumOf(row, "kind", KINDS),
  normalizedKey: text(row, "normalized_key"),
  userId: UserId.create(text(row, "user_id")),
  operationId: text(row, "operation_id"),
  claimToken: text(row, "claim_token"),
  state: enumOf(row, "state", STATES),
  expiresAt: dateOrNull(row, "expires_at"),
  userVersion: intOrNull(row, "user_version"),
  raw: row,
});

export type D1IdentityUniqueDirectoryDeps = Readonly<{
  session: SqlSession;
  clock: Clock;
  idGenerator: IdGenerator;
}>;

/**
 * `identity_unique_reservations` on global D1.
 *
 * Every transition is a compare-and-set: the branch is decided from the
 * row this call read, and an `occGuard` repeating that same predicate is
 * staged in front of the write so a racing writer that changed the row in
 * between aborts the batch instead of overwriting a decision made about a
 * state that no longer holds.
 *
 * `operation_id` carries a UNIQUE of its own, so one operation holds at
 * most one reservation row here and the operation-keyed reads yield at
 * most one.
 *
 * `claim_token` is minted only where a row is **inserted**, never in the
 * `activate` / `beginRelease` updates — the contract requires a token
 * that outlives its claim's state changes and differs for a claim taken
 * after a teardown, including under the same (deterministic) operation id
 * (`spec/adr/060-conditional-unique-claim-teardown.md`).
 */
export function createD1IdentityUniqueDirectory(
  deps: D1IdentityUniqueDirectoryDeps,
): IdentityUniqueDirectory {
  const { session, clock, idGenerator } = deps;

  const readOne = async (
    kind: IdentityUniqueKind,
    normalizedKey: string,
  ): Promise<Reservation | null> => {
    const row = await session.readRow({
      table: TABLE,
      key: rowKey(kind, normalizedKey),
      statement: statement(
        `SELECT * FROM ${TABLE} WHERE kind = ? AND normalized_key = ?`,
        kind,
        normalizedKey,
      ),
    });
    return row === null ? null : toReservation(row);
  };

  const readByOperation = async (
    operationId: string,
  ): Promise<readonly Reservation[]> => {
    const rows = await session.readRows({
      table: TABLE,
      statement: statement(
        `SELECT * FROM ${TABLE} WHERE operation_id = ?`,
        operationId,
      ),
      keyOf: (row) =>
        compositeKey(text(row, "kind"), text(row, "normalized_key")),
      matches: (row) => row.operation_id === operationId,
    });
    return rows.map(toReservation);
  };

  /**
   * The answer the read path would have given had the winning writer
   * landed first, re-derived after a guard tripped: the reservation moved
   * to another operation, or the user version moved on.
   *
   * `null` is that answer being success — a concurrent replay of the same
   * operation activated the very rows this call meant to activate, at the
   * same version, which is what the read path's own `state !== 'active'`
   * filter would have left with nothing to write. At-least-once
   * continuation delivery makes that replay a real path.
   */
  const activateLoss = async (
    operationId: string,
    expectedUserVersion: number,
  ): Promise<ConflictError | null> => {
    const reservations = await readByOperation(operationId);
    if (reservations.length === 0) {
      return new ConflictError(
        "UNIQUE_RESERVATION_NOT_FOUND",
        `No reservation for operation ${operationId}`,
      );
    }
    if (
      reservations.every(
        (reservation) =>
          reservation.state === "active" &&
          reservation.userVersion === expectedUserVersion,
      )
    ) {
      return null;
    }
    return new ConflictError(
      "OPTIMISTIC_LOCK_FAILURE",
      `Reservations of operation ${operationId} moved away from version ${expectedUserVersion}`,
    );
  };

  const activeClaim = async (
    kind: IdentityUniqueKind,
    normalizedKey: string,
  ): Promise<ActiveUniqueClaim | null> => {
    const row = await readOne(kind, normalizedKey);
    return row !== null && row.state === "active"
      ? { userId: row.userId, claimToken: row.claimToken }
      : null;
  };

  return {
    async resolveClaim(kind, normalizedKey) {
      return activeClaim(kind, normalizedKey);
    },

    async resolve(kind, normalizedKey) {
      return (await activeClaim(kind, normalizedKey))?.userId ?? null;
    },

    async reserve(input): Promise<void> {
      const now = clock.now();
      const key = rowKey(input.kind, input.normalizedKey);
      const existing = await readOne(input.kind, input.normalizedKey);

      if (existing !== null && existing.operationId === input.operationId) {
        if (existing.state !== "reserved") {
          return;
        }
        try {
          await session.write([
            opaque(
              occGuard(
                statement(
                  `SELECT 1 FROM ${TABLE} WHERE kind = ? AND normalized_key = ? AND operation_id = ? AND state = 'reserved'`,
                  input.kind,
                  input.normalizedKey,
                  input.operationId,
                ),
              ),
            ),
            upsert({
              table: TABLE,
              key,
              row: {
                ...existing.raw,
                expires_at: toTimestamp(input.expiresAt),
                updated_at: toTimestamp(now),
              },
              statement: statement(
                `UPDATE ${TABLE} SET expires_at = ?, updated_at = ? WHERE kind = ? AND normalized_key = ? AND operation_id = ?`,
                toTimestamp(input.expiresAt),
                toTimestamp(now),
                input.kind,
                input.normalizedKey,
                input.operationId,
              ),
            }),
          ]);
        } catch (cause) {
          throw translateReserve(cause, input.kind, input.normalizedKey);
        }
        return;
      }

      if (existing !== null) {
        const lapsed =
          existing.state === "reserved" &&
          existing.expiresAt !== null &&
          existing.expiresAt.getTime() <= now.getTime();
        if (!lapsed) {
          throw heldByAnother(input.kind, input.normalizedKey);
        }
      }

      const claimToken = idGenerator.next();
      const row: SqlRow = {
        kind: input.kind,
        normalized_key: input.normalizedKey,
        user_id: input.userId,
        operation_id: input.operationId,
        claim_token: claimToken,
        state: "reserved",
        expires_at: toTimestamp(input.expiresAt),
        user_version: null,
        updated_at: toTimestamp(now),
      };
      try {
        await session.write([
          opaque(
            occGuard(
              statement(
                `SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM ${TABLE} WHERE kind = ? AND normalized_key = ? AND (state <> 'reserved' OR expires_at IS NULL OR expires_at > ?))`,
                input.kind,
                input.normalizedKey,
                toTimestamp(now),
              ),
            ),
          ),
          upsert({
            table: TABLE,
            key,
            row,
            statement: statement(
              `INSERT INTO ${TABLE}
                 (kind, normalized_key, user_id, operation_id, claim_token, state, expires_at, user_version, updated_at)
               VALUES (?, ?, ?, ?, ?, 'reserved', ?, NULL, ?)
               ON CONFLICT (kind, normalized_key) DO UPDATE SET
                 user_id = excluded.user_id,
                 operation_id = excluded.operation_id,
                 claim_token = excluded.claim_token,
                 state = 'reserved',
                 expires_at = excluded.expires_at,
                 user_version = NULL,
                 updated_at = excluded.updated_at`,
              input.kind,
              input.normalizedKey,
              input.userId,
              input.operationId,
              claimToken,
              toTimestamp(input.expiresAt),
              toTimestamp(now),
            ),
          }),
        ]);
      } catch (cause) {
        throw translateReserve(cause, input.kind, input.normalizedKey);
      }
    },

    async activate(
      operationId: string,
      expectedUserVersion: number,
    ): Promise<void> {
      const reservations = await readByOperation(operationId);
      if (reservations.length === 0) {
        throw new ConflictError(
          "UNIQUE_RESERVATION_NOT_FOUND",
          `No reservation for operation ${operationId}`,
        );
      }
      for (const reservation of reservations) {
        const userRow = await session.readRow({
          table: USERS,
          key: reservation.userId,
          statement: statement(
            `SELECT version FROM ${USERS} WHERE id = ?`,
            reservation.userId,
          ),
        });
        if (userRow === null || userRow.version !== expectedUserVersion) {
          throw new ConflictError(
            "OPTIMISTIC_LOCK_FAILURE",
            `User ${reservation.userId} is not at version ${expectedUserVersion}`,
          );
        }
      }

      const now = toTimestamp(clock.now());
      const mutations = reservations
        .filter((reservation) => reservation.state !== "active")
        .flatMap((reservation) => [
          opaque(
            occGuard(
              statement(
                `SELECT 1 FROM ${TABLE} r JOIN ${USERS} u ON u.id = r.user_id
                  WHERE r.kind = ? AND r.normalized_key = ? AND r.operation_id = ?
                    AND r.state <> 'active' AND u.version = ?`,
                reservation.kind,
                reservation.normalizedKey,
                reservation.operationId,
                expectedUserVersion,
              ),
            ),
          ),
          upsert({
            table: TABLE,
            key: rowKey(reservation.kind, reservation.normalizedKey),
            row: {
              ...reservation.raw,
              state: "active",
              expires_at: null,
              user_version: expectedUserVersion,
              updated_at: now,
            },
            statement: statement(
              `UPDATE ${TABLE} SET state = 'active', expires_at = NULL, user_version = ?, updated_at = ? WHERE kind = ? AND normalized_key = ? AND operation_id = ?`,
              expectedUserVersion,
              now,
              reservation.kind,
              reservation.normalizedKey,
              reservation.operationId,
            ),
          }),
        ]);
      if (mutations.length === 0) {
        return;
      }
      try {
        await session.write(mutations);
      } catch (cause) {
        if (classifySqlError(cause) === "occGuard") {
          const loss = await activateLoss(operationId, expectedUserVersion);
          if (loss === null) {
            return;
          }
          throw loss;
        }
        throwTranslated("the identity uniqueness directory", cause);
      }
    },

    async beginRelease(input): Promise<void> {
      const existing = await readOne(input.kind, input.normalizedKey);
      if (
        existing === null ||
        existing.state !== "active" ||
        existing.userId !== input.expectedUserId ||
        existing.claimToken !== input.expectedClaimToken
      ) {
        return;
      }
      const now = toTimestamp(clock.now());
      try {
        await session.write([
          opaque(
            occGuard(
              statement(
                `SELECT 1 FROM ${TABLE} WHERE kind = ? AND normalized_key = ? AND state = 'active' AND user_id = ? AND claim_token = ?`,
                input.kind,
                input.normalizedKey,
                input.expectedUserId,
                input.expectedClaimToken,
              ),
            ),
          ),
          upsert({
            table: TABLE,
            key: rowKey(input.kind, input.normalizedKey),
            row: {
              ...existing.raw,
              state: "releasing",
              operation_id: input.operationId,
              expires_at: null,
              updated_at: now,
            },
            // Re-keyed to the releasing operation so the paired `release`
            // can find it: the reservation's own operation id belongs to a
            // past operation and cannot be re-derived.
            statement: statement(
              `UPDATE ${TABLE} SET state = 'releasing', operation_id = ?, expires_at = NULL, updated_at = ? WHERE kind = ? AND normalized_key = ? AND state = 'active' AND user_id = ? AND claim_token = ?`,
              input.operationId,
              now,
              input.kind,
              input.normalizedKey,
              input.expectedUserId,
              input.expectedClaimToken,
            ),
          }),
        ]);
      } catch (cause) {
        if (classifySqlError(cause) === "occGuard") {
          // The read path above is a no-op on exactly the conditions this
          // guard repeats, so a caller that loses the race must get that
          // same silence rather than a conflict it cannot act on.
          const observed = await activeClaim(input.kind, input.normalizedKey);
          if (
            observed === null ||
            observed.userId !== input.expectedUserId ||
            observed.claimToken !== input.expectedClaimToken
          ) {
            return;
          }
        }
        throwTranslated("the identity uniqueness directory", cause);
      }
    },

    async release(operationId: string): Promise<void> {
      const reservations = (await readByOperation(operationId)).filter(
        (reservation) =>
          reservation.state === "reserved" || reservation.state === "releasing",
      );
      if (reservations.length === 0) {
        return;
      }
      try {
        await session.write(
          reservations.map((reservation) =>
            remove({
              table: TABLE,
              key: rowKey(reservation.kind, reservation.normalizedKey),
              statement: statement(
                `DELETE FROM ${TABLE} WHERE kind = ? AND normalized_key = ? AND operation_id = ? AND state IN ('reserved', 'releasing')`,
                reservation.kind,
                reservation.normalizedKey,
                operationId,
              ),
            }),
          ),
        );
      } catch (cause) {
        throwTranslated("the identity uniqueness directory", cause);
      }
    },
  };
}

/**
 * A lost race on a uniqueness key is the same answer as losing it by
 * reading first: the key is held by somebody else.
 *
 * Not every unique violation says that, though. `operation_id` carries a
 * UNIQUE of its own, so one operation reserves at most one key, and a
 * second key reserved under the same operation id trips it while the key
 * itself is free. Reporting that as "already used" would refuse a key
 * nobody holds, so it stays a fault.
 */
function translateReserve(
  cause: unknown,
  kind: IdentityUniqueKind,
  normalizedKey: string,
): unknown {
  const failure = classifySqlError(cause);
  if (
    failure === "occGuard" ||
    (failure === "unique" && !onOperationId(cause))
  ) {
    return heldByAnother(kind, normalizedKey);
  }
  return databaseError("the identity uniqueness directory", cause);
}

const onOperationId = (cause: unknown): boolean =>
  (cause instanceof Error ? cause.message : String(cause)).includes(
    `${TABLE}.operation_id`,
  );
