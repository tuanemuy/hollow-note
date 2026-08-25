import type { Clock } from "../../../../application/ports/clock";
import type { IdempotencyStore } from "../../../../application/ports/idempotencyStore";
import type { EventId } from "../../../../domain/common/event";
import { opaque, upsert } from "../../execution/writeSet";
import { throwTranslated } from "../../sql/errors";
import { occGuard } from "../../sql/occGuard";
import { compositeKey, toTimestamp } from "../../sql/row";
import type { SqlSession } from "../../sql/session";
import { statement } from "../../sql/statement";
import { GLOBAL_TABLES } from "../schema";

const TABLE = GLOBAL_TABLES.processedEvents;

/**
 * Duplicate suppression for non-commutative event consumers.
 *
 * The port asks for two things that pull in different directions: the
 * mark has to be **atomic** (concurrent callers see exactly one `true`),
 * and it has to share a unit of work with the effect it guards so neither
 * can commit alone. Which one the session is decides how it is done.
 *
 * Outside a unit of work there is nothing to join, so the insert is its
 * own atomic step and `RETURNING` reports whether this caller is the one
 * that wrote the row. Inside one, the answer is needed before the commit
 * exists, so the row is read first and the write staged with an
 * `_occ_guard` asserting the absence still holds — a consumer that lost
 * the race aborts its whole unit instead of committing a second effect.
 */
export function createD1IdempotencyStore(
  deps: Readonly<{ session: SqlSession; clock: Clock }>,
): IdempotencyStore {
  const { session } = deps;

  const mark = async (consumer: string, eventId: EventId): Promise<boolean> => {
    const processedAt = toTimestamp(deps.clock.now());
    if (!session.staged) {
      const rows = await session.query(
        statement(
          `INSERT INTO ${TABLE} (consumer, event_id, processed_at)
           VALUES (?, ?, ?)
           ON CONFLICT (consumer, event_id) DO NOTHING
           RETURNING event_id`,
          consumer,
          eventId,
          processedAt,
        ),
      );
      return rows.length > 0;
    }

    const key = compositeKey(consumer, eventId);
    const existing = await session.readRow({
      table: TABLE,
      key,
      statement: statement(
        `SELECT consumer, event_id, processed_at FROM ${TABLE}
          WHERE consumer = ? AND event_id = ?`,
        consumer,
        eventId,
      ),
    });
    if (existing !== null) {
      return false;
    }
    await session.write([
      opaque(
        occGuard(
          statement(
            `SELECT 1 WHERE NOT EXISTS (
               SELECT 1 FROM ${TABLE} WHERE consumer = ? AND event_id = ?
             )`,
            consumer,
            eventId,
          ),
        ),
      ),
      upsert({
        table: TABLE,
        key,
        row: {
          consumer,
          event_id: eventId,
          processed_at: processedAt,
        },
        statement: statement(
          `INSERT INTO ${TABLE} (consumer, event_id, processed_at)
           VALUES (?, ?, ?)
           ON CONFLICT (consumer, event_id) DO NOTHING`,
          consumer,
          eventId,
          processedAt,
        ),
      }),
    ]);
    return true;
  };

  return {
    async markProcessed(consumer: string, eventId: EventId): Promise<boolean> {
      try {
        return await mark(consumer, eventId);
      } catch (cause) {
        throwTranslated(`${TABLE} row ${consumer}/${eventId}`, cause);
      }
    },
  };
}
