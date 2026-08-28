import type { PrunePage } from "../../../../domain/common/pagination";
import type { SessionRepository } from "../../../../domain/identity/ports/sessionRepository";
import type { Session } from "../../../../domain/identity/session";
import { Session as SessionAggregate } from "../../../../domain/identity/session";
import type {
  SessionId,
  TokenHash,
  UserId,
} from "../../../../domain/identity/valueObject";
import { remove, upsert } from "../../execution/writeSet";
import { date, int, text, toTimestamp } from "../../sql/row";
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

const TABLE = GLOBAL_TABLES.sessions;

const COLUMNS = [
  "id",
  "user_id",
  "token_hash",
  "auth_epoch",
  "created_at",
  "expires_at",
] as const;

const writer = createTableWriter(TABLE, COLUMNS, ["id"]);

const toRow = (session: Session): SqlRow => ({
  id: session.id,
  user_id: session.userId,
  token_hash: session.tokenHash,
  auth_epoch: session.authEpoch,
  created_at: toTimestamp(session.createdAt),
  expires_at: toTimestamp(session.expiresAt),
});

const fromRow = (row: SqlRow): Session =>
  SessionAggregate.reconstruct({
    id: text(row, "id"),
    userId: text(row, "user_id"),
    tokenHash: text(row, "token_hash"),
    authEpoch: int(row, "auth_epoch"),
    createdAt: date(row, "created_at"),
    expiresAt: date(row, "expires_at"),
  });

/**
 * `sessions` on global D1. Lookup by wire token narrows to a single row
 * through the `token_hash` UNIQUE and matches `user_id` as the owner
 * check (the same shape as `auth_tokens.findByTokenHash`) — the UserId
 * locator routes the request to the shard and the hash is matched inside
 * it, never by scanning.
 */
export function createD1SessionRepository(
  deps: Readonly<{ session: SqlSession }>,
): SessionRepository {
  const { session: sql } = deps;
  return {
    async insert(session: Session): Promise<void> {
      const row = toRow(session);
      await writeTranslated(sql, `${TABLE} insert`, [
        upsert({
          table: TABLE,
          key: session.id,
          row,
          statement: writer.insert(row),
        }),
      ]);
    },

    async findByTokenHash(
      userId: UserId,
      tokenHash: TokenHash,
    ): Promise<Session | null> {
      const rows = await sql.readRows({
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

    async deleteById(id: SessionId): Promise<void> {
      await writeTranslated(sql, `${TABLE} row ${id}`, [
        remove({
          table: TABLE,
          key: id,
          statement: statement(`DELETE FROM ${TABLE} WHERE id = ?`, id),
        }),
      ]);
    },

    async refreshAuthEpoch(
      id: SessionId,
      userId: UserId,
      authEpoch: number,
    ): Promise<void> {
      const stored = await sql.readRow({
        table: TABLE,
        key: id,
        statement: statement(`SELECT * FROM ${TABLE} WHERE id = ?`, id),
      });
      if (stored === null || text(stored, "user_id") !== userId) {
        return;
      }
      await writeTranslated(sql, `${TABLE} row ${id}`, [
        upsert({
          table: TABLE,
          key: id,
          row: { ...stored, auth_epoch: authEpoch },
          statement: statement(
            `UPDATE ${TABLE} SET auth_epoch = ? WHERE id = ? AND user_id = ?`,
            authEpoch,
            id,
            userId,
          ),
        }),
      ]);
    },

    async deleteOlderEpochByUser(
      userId: UserId,
      currentEpoch: number,
      limit: number,
    ): Promise<number> {
      return deleteBoundedByKey(
        sql,
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
        sql,
        { table: TABLE, keyColumn: "id", expiresColumn: "expires_at" },
        now,
        cursor,
        limit,
      );
    },
  };
}
