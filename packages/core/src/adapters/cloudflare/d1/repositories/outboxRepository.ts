import type { Clock } from "../../../../application/ports/clock";
import type {
  ClaimPendingArgs,
  FinalizeOutboxArgs,
  OutboxEntry,
  OutboxRepository,
} from "../../../../application/ports/outboxRepository";
import type { DomainEvent } from "../../../../domain/common/event";
import type { RowMutation } from "../../execution/writeSet";
import { opaque } from "../../execution/writeSet";
import { databaseError, throwTranslated } from "../../sql/errors";
import {
  inJsonList,
  insertRowsFromJson,
  jsonList,
  jsonRows,
} from "../../sql/json";
import { int, json, text, toTimestamp } from "../../sql/row";
import type { SqlSession } from "../../sql/session";
import { type SqlRow, type SqlStatement, statement } from "../../sql/statement";
import { GLOBAL_TABLES } from "../schema";

const TABLE = GLOBAL_TABLES.outboxEvents;

/**
 * Ceiling for the single JSON binding `save` folds a whole batch into.
 * Both planes cap one bound value at 2,000,000 bytes
 * (`spec/platform/index.md` 実上限); half of that is the design budget,
 * on the same reasoning as the query budget there — the remainder is
 * headroom for the driver's own framing.
 */
const MAX_SAVE_BINDING_BYTES = 1_000_000;

const SAVE_COLUMNS = [
  "id",
  "type",
  "payload",
  "occurred_at",
  "aggregate_id",
  "created_at",
  "attempts",
] as const;

const toEntry = (row: SqlRow): OutboxEntry => ({
  id: text(row, "id"),
  type: text(row, "type"),
  payload: json<unknown>(row, "payload"),
  occurredAt: new Date(int(row, "occurred_at")),
  aggregateId: text(row, "aggregate_id"),
  attempts: int(row, "attempts"),
});

/**
 * The transactional outbox, in SQL.
 *
 * One implementation serves both planes: `outbox_events` has the same
 * shape in the global D1 migration and in a scope object's schema, and
 * the repository is built over whichever `SqlSession` it is handed — so
 * `save` stages into a unit of work's write-set on either plane, and the
 * relay's claim / finalize cycle runs against the same statements.
 *
 * `save` folds a stored id onto its existing row and leaves it untouched
 * ([ADR 042](../../../../../../spec/adr/042-outbox-save-id-collision.md)):
 * a replayed turn re-derives the same deterministic id, and putting an
 * already-dispatched continuation back on the wire would re-run the tail
 * of a chain that has moved on. `ON CONFLICT DO NOTHING` is exactly that
 * rule, and it keeps the whole batch to one statement.
 *
 * `claimPending` is a single statement with `RETURNING`, which is how a
 * driver with no interactive transaction still hands out rows atomically:
 * the same statement that takes the lease is the one that reports what it
 * took, so two workers cannot both see a row as claimable. `pruneProcessed`
 * is one statement too, but its caller only wants a count, so it reads the
 * driver's affected-row count instead of returning the rows. That count is
 * the one thing the two planes do not share: only D1 reports it, so
 * `pruneProcessed` serves the global outbox alone until the slice that
 * relays a scope object's outbox teaches that plane's executor to count
 * (`../../sql/executor.ts`, `applyCounted`). Nothing calls it there today —
 * `pruneOutbox` runs on the worker container's global repository.
 */
export function createD1OutboxRepository(
  deps: Readonly<{ session: SqlSession; clock: Clock }>,
): OutboxRepository {
  const { session } = deps;

  const query = async (input: SqlStatement): Promise<readonly SqlRow[]> => {
    try {
      return await session.query(input);
    } catch (cause) {
      throwTranslated(TABLE, cause);
    }
  };

  const write = async (mutations: readonly RowMutation[]): Promise<void> => {
    try {
      await session.write(mutations);
    } catch (cause) {
      throwTranslated(TABLE, cause);
    }
  };

  const writeCounted = async (input: SqlStatement): Promise<number> => {
    try {
      return await session.writeCounted(input);
    } catch (cause) {
      throwTranslated(TABLE, cause);
    }
  };

  /**
   * The relay's two housekeeping calls run their own statement rather
   * than staging one, so inside a unit of work they would commit while
   * the unit around them still could not. The port places both outside
   * one; refusing is how that stays true rather than assumed.
   */
  const refuseStaged = (operation: string): void => {
    if (session.staged) {
      throw databaseError(`${operation} must run outside a unit of work`);
    }
  };

  return {
    async save(events: readonly DomainEvent[]): Promise<void> {
      if (events.length === 0) {
        return;
      }
      const createdAt = toTimestamp(deps.clock.now());
      const rows = events.map((event) => ({
        id: event.id,
        type: event.type,
        payload: JSON.stringify(event.payload),
        occurred_at: toTimestamp(event.occurredAt),
        aggregate_id: event.aggregateId,
        created_at: createdAt,
        attempts: 0,
      }));
      const batch = jsonRows(rows);
      const size = new TextEncoder().encode(batch).length;
      if (size > MAX_SAVE_BINDING_BYTES) {
        throw databaseError(
          `Saving ${events.length} outbox events binds ${size} bytes, above the ${MAX_SAVE_BINDING_BYTES} limit; split the batch or shrink the payloads`,
        );
      }
      // A bulk insert has no single-row image, so it stages as `opaque`:
      // nothing reads the outbox back inside the unit that wrote it.
      await write([
        opaque(
          statement(
            insertRowsFromJson({
              table: TABLE,
              columns: [...SAVE_COLUMNS],
              conflictKey: ["id"],
              conflict: "ignore",
            }),
            batch,
          ),
        ),
      ]);
    },

    async claimPending(
      args: ClaimPendingArgs,
    ): Promise<readonly OutboxEntry[]> {
      refuseStaged("claimPending");
      if (args.limit <= 0) {
        return [];
      }
      const nowMs = args.now.getTime();
      const rows = await query(
        statement(
          `UPDATE ${TABLE}
              SET claimed_at = ?, claimed_by = ?
            WHERE id IN (
              SELECT id FROM ${TABLE}
               WHERE processed_at IS NULL
                 AND failed_at IS NULL
                 AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
                 AND (claimed_at IS NULL OR claimed_at <= ?)
               ORDER BY created_at, id
               LIMIT ?
            )
            RETURNING id, type, payload, occurred_at, aggregate_id, attempts, created_at`,
          nowMs,
          args.workerId,
          nowMs,
          nowMs - args.leaseMs,
          args.limit,
        ),
      );
      // `RETURNING` does not promise the statement's own order, so the
      // approximate FIFO the port describes is restored here.
      return [...rows]
        .sort(
          (a, b) =>
            int(a, "created_at") - int(b, "created_at") ||
            (text(a, "id") < text(b, "id") ? -1 : 1),
        )
        .map(toEntry);
    },

    async finalize(args: FinalizeOutboxArgs): Promise<void> {
      if (args.processed.length === 0 && args.failures.length === 0) {
        return;
      }
      const nowMs = toTimestamp(args.now);
      const mutations = [];
      if (args.processed.length > 0) {
        mutations.push(
          opaque(
            statement(
              `UPDATE ${TABLE}
                  SET processed_at = ?, claimed_at = NULL, claimed_by = NULL
                WHERE ${inJsonList("id")}`,
              nowMs,
              jsonList([...args.processed]),
            ),
          ),
        );
      }
      if (args.failures.length > 0) {
        const payload = args.failures.map((failure) => ({
          id: failure.id,
          error: failure.error,
          next_attempt_at:
            failure.nextAttemptAt === null
              ? null
              : toTimestamp(failure.nextAttemptAt),
        }));
        mutations.push(
          opaque(
            statement(
              `UPDATE ${TABLE}
                  SET attempts = attempts + 1,
                      last_error = json_extract(failure.value, '$.error'),
                      next_attempt_at = json_extract(failure.value, '$.next_attempt_at'),
                      failed_at = CASE
                        WHEN json_extract(failure.value, '$.next_attempt_at') IS NULL THEN ?
                        ELSE NULL
                      END,
                      claimed_at = NULL,
                      claimed_by = NULL
                 FROM json_each(?) AS failure
                WHERE ${TABLE}.id = json_extract(failure.value, '$.id')`,
              nowMs,
              jsonRows(payload),
            ),
          ),
        );
      }
      // Successes and failures land in one atomic step, so a crash cannot
      // leave a dispatched row claimable again.
      await write(mutations);
    },

    async pruneProcessed(olderThan: Date): Promise<{ deleted: number }> {
      refuseStaged("pruneProcessed");
      // The port has no limit, so the sweep is unbounded; counting with
      // `RETURNING` would put one row per deletion on the wire and a
      // backlog would make the response, not the statement count, the
      // thing that fails.
      const deleted = await writeCounted(
        statement(
          `DELETE FROM ${TABLE}
            WHERE processed_at IS NOT NULL AND processed_at < ?`,
          toTimestamp(olderThan),
        ),
      );
      return { deleted };
    },
  };
}
