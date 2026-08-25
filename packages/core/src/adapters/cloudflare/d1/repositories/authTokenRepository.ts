import { ConflictError } from "../../../../application/errors";
import type { PrunePage } from "../../../../domain/common/pagination";
import type {
  AuthToken,
  PendingAuthToken,
} from "../../../../domain/identity/authToken";
import { AuthToken as AuthTokenAggregate } from "../../../../domain/identity/authToken";
import type { AuthTokenRepository } from "../../../../domain/identity/ports/authTokenRepository";
import type {
  AuthTokenPurpose,
  TokenHash,
  UserId,
} from "../../../../domain/identity/valueObject";
import { opaque, upsert } from "../../execution/writeSet";
import { classifySqlError, throwTranslated } from "../../sql/errors";
import { occGuard } from "../../sql/occGuard";
import {
  date,
  dateOrNull,
  int,
  text,
  toTimestamp,
  toTimestampOrNull,
} from "../../sql/row";
import type { SqlSession } from "../../sql/session";
import type { SqlRow } from "../../sql/statement";
import { statement } from "../../sql/statement";
import { GLOBAL_TABLES } from "../schema";
import {
  createTableWriter,
  deleteBoundedByKey,
  deleteExpiredPage,
  writeTranslated,
} from "./identitySupport";

const TABLE = GLOBAL_TABLES.authTokens;

const COLUMNS = [
  "id",
  "user_id",
  "purpose",
  "token_hash",
  "auth_epoch",
  "status",
  "consumed_at",
  "created_at",
  "expires_at",
] as const;

const writer = createTableWriter(TABLE, COLUMNS, ["id"]);

const toRow = (token: AuthToken): SqlRow => ({
  id: token.id,
  user_id: token.userId,
  purpose: token.purpose,
  token_hash: token.tokenHash,
  auth_epoch: token.authEpoch,
  status: token.status,
  consumed_at:
    token.status === "consumed" ? toTimestampOrNull(token.consumedAt) : null,
  created_at: toTimestamp(token.createdAt),
  expires_at: toTimestamp(token.expiresAt),
});

const fromRow = (row: SqlRow): AuthToken =>
  AuthTokenAggregate.reconstruct({
    id: text(row, "id"),
    userId: text(row, "user_id"),
    purpose: text(row, "purpose"),
    tokenHash: text(row, "token_hash"),
    authEpoch: int(row, "auth_epoch"),
    status: text(row, "status"),
    createdAt: date(row, "created_at"),
    expiresAt: date(row, "expires_at"),
    consumedAt: dateOrNull(row, "consumed_at"),
  });

const alreadyConsumed = (id: string): ConflictError =>
  new ConflictError(
    "AUTH_TOKEN_ALREADY_CONSUMED",
    `Auth token ${id} is not pending`,
  );

/**
 * `auth_tokens` on global D1.
 *
 * Consumption is a conditional update on the `pending` row: the staged
 * read decides the outcome for the caller, and the `_occ_guard` trip wire
 * repeats the condition at apply time so that exactly one of two
 * concurrent consumers wins even though both read `pending`.
 */
export function createD1AuthTokenRepository(
  deps: Readonly<{ session: SqlSession }>,
): AuthTokenRepository {
  const { session } = deps;
  return {
    async insert(token: AuthToken): Promise<void> {
      const row = toRow(token);
      await writeTranslated(session, `${TABLE} insert`, [
        upsert({
          table: TABLE,
          key: token.id,
          row,
          statement: writer.insert(row),
        }),
      ]);
    },

    async findByTokenHash(
      userId: UserId,
      tokenHash: TokenHash,
    ): Promise<AuthToken | null> {
      const rows = await session.readRows({
        table: TABLE,
        statement: statement(
          `SELECT * FROM ${TABLE} WHERE user_id = ? AND token_hash = ? LIMIT 1`,
          userId,
          tokenHash,
        ),
        keyOf: (row) => text(row, "id"),
        matches: (row) =>
          text(row, "user_id") === userId &&
          text(row, "token_hash") === tokenHash,
        limit: 1,
      });
      const row = rows[0];
      return row === undefined ? null : fromRow(row);
    },

    async findPendingByUserAndPurpose(
      userId: UserId,
      purpose: AuthTokenPurpose,
    ): Promise<PendingAuthToken | null> {
      const rows = await session.readRows({
        table: TABLE,
        statement: statement(
          `SELECT * FROM ${TABLE}
           WHERE user_id = ? AND purpose = ? AND status = 'pending' LIMIT 1`,
          userId,
          purpose,
        ),
        keyOf: (row) => text(row, "id"),
        matches: (row) =>
          text(row, "user_id") === userId &&
          text(row, "purpose") === purpose &&
          text(row, "status") === "pending",
        limit: 1,
      });
      const row = rows[0];
      if (row === undefined) {
        return null;
      }
      const token = fromRow(row);
      return token.status === "pending" ? token : null;
    },

    async save(token: AuthToken): Promise<void> {
      const row = toRow(token);
      if (token.status !== "consumed") {
        await writeTranslated(session, `${TABLE} row ${token.id}`, [
          upsert({
            table: TABLE,
            key: token.id,
            row,
            statement: writer.upsert(row),
          }),
        ]);
        return;
      }
      const stored = await session.readRow({
        table: TABLE,
        key: token.id,
        statement: statement(`SELECT * FROM ${TABLE} WHERE id = ?`, token.id),
      });
      if (stored === null || text(stored, "status") !== "pending") {
        throw alreadyConsumed(token.id);
      }
      try {
        await session.write([
          opaque(
            occGuard(
              statement(
                `SELECT 1 FROM ${TABLE} WHERE id = ? AND status = 'pending'`,
                token.id,
              ),
            ),
          ),
          upsert({
            table: TABLE,
            key: token.id,
            row,
            statement: writer.upsert(row),
          }),
        ]);
      } catch (cause) {
        if (classifySqlError(cause) === "occGuard") {
          throw alreadyConsumed(token.id);
        }
        throwTranslated(`${TABLE} row ${token.id}`, cause);
      }
    },

    async deleteByUserAndPurpose(
      userId: UserId,
      purpose: AuthTokenPurpose,
      limit: number,
    ): Promise<number> {
      return deleteBoundedByKey(
        session,
        {
          table: TABLE,
          keyColumn: "id",
          where: statement("user_id = ? AND purpose = ?", userId, purpose),
        },
        limit,
      );
    },

    async deleteOlderEpochByUser(
      userId: UserId,
      currentEpoch: number,
      limit: number,
    ): Promise<number> {
      return deleteBoundedByKey(
        session,
        {
          table: TABLE,
          keyColumn: "id",
          where: statement(
            "user_id = ? AND auth_epoch < ?",
            userId,
            currentEpoch,
          ),
        },
        limit,
      );
    },

    async deleteExpired(
      now: Date,
      cursor: string | null,
      limit: number,
    ): Promise<PrunePage> {
      return deleteExpiredPage(
        session,
        { table: TABLE, keyColumn: "id", expiresColumn: "expires_at" },
        now,
        cursor,
        limit,
      );
    },
  };
}
