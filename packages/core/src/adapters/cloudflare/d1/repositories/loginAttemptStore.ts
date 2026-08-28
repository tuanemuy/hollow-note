import type { Clock } from "../../../../application/ports/clock";
import type { PrunePage } from "../../../../domain/common/pagination";
import type { LoginAttemptStore } from "../../../../domain/identity/ports/loginAttemptStore";
import type { LoginAttempt } from "../../../../domain/identity/services/loginThrottlePolicy";
import { remove } from "../../execution/writeSet";
import { databaseError } from "../../sql/errors";
import { dateOrNull, int, text, toTimestamp } from "../../sql/row";
import type { SqlSession } from "../../sql/session";
import { statement } from "../../sql/statement";
import { GLOBAL_TABLES } from "../schema";
import { deleteExpiredPage, writeTranslated } from "./identitySupport";

const TABLE = GLOBAL_TABLES.loginAttempts;

/**
 * `login_attempts` on global D1.
 *
 * `recordFailure` is the single upsert of `spec/database/index.md#login_attempts`
 * with one addition: a row whose TTL has already lapsed restarts the
 * count at 1 rather than continuing it, which is what makes an expired
 * record read as absent *and* behave as absent. The written value still
 * does not depend on a value the caller read, so the operation stays one
 * atomic statement and no threshold rule leaks into the SQL.
 */
export function createD1LoginAttemptStore(
  deps: Readonly<{ session: SqlSession; clock: Clock }>,
): LoginAttemptStore {
  const { session, clock } = deps;
  return {
    async get(key: string): Promise<LoginAttempt | null> {
      const row = await session.readRow({
        table: TABLE,
        key,
        statement: statement(`SELECT * FROM ${TABLE} WHERE key = ?`, key),
      });
      if (row === null) {
        return null;
      }
      if (int(row, "expires_at") <= clock.now().getTime()) {
        return null;
      }
      return {
        key: text(row, "key"),
        failureCount: int(row, "failure_count"),
        lastFailedAt: dateOrNull(row, "last_failed_at"),
      };
    },

    async recordFailure(
      key: string,
      now: Date,
      ttlMs: number,
    ): Promise<LoginAttempt> {
      const at = toTimestamp(now);
      const rows = await session
        .query(
          statement(
            `INSERT INTO ${TABLE} (key, failure_count, last_failed_at, expires_at)
             VALUES (?, 1, ?, ?)
             ON CONFLICT(key) DO UPDATE SET
               failure_count = CASE
                 WHEN ${TABLE}.expires_at <= ? THEN 1
                 ELSE ${TABLE}.failure_count + 1
               END,
               last_failed_at = excluded.last_failed_at,
               expires_at = excluded.expires_at
             RETURNING failure_count, last_failed_at`,
            key,
            at,
            at + ttlMs,
            at,
          ),
        )
        .catch((cause: unknown) => {
          throw databaseError(`${TABLE} recordFailure`, cause);
        });
      const row = rows[0];
      if (row === undefined) {
        throw databaseError(`${TABLE} recordFailure returned no row`);
      }
      return {
        key,
        failureCount: int(row, "failure_count"),
        lastFailedAt: dateOrNull(row, "last_failed_at"),
      };
    },

    async clear(key: string): Promise<void> {
      await writeTranslated(session, `${TABLE} row ${key}`, [
        remove({
          table: TABLE,
          key,
          statement: statement(`DELETE FROM ${TABLE} WHERE key = ?`, key),
        }),
      ]);
    },

    async deleteExpired(
      now: Date,
      cursor: string | null,
      limit: number,
    ): Promise<PrunePage> {
      return deleteExpiredPage(
        session,
        { table: TABLE, keyColumn: "key", expiresColumn: "expires_at" },
        now,
        cursor,
        limit,
      );
    },
  };
}
