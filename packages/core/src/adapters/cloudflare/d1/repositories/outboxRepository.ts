import type { Clock } from "../../../../application/ports/clock";
import type {
  ClaimPendingArgs,
  FinalizeOutboxArgs,
  OutboxEntry,
  OutboxRepository,
} from "../../../../application/ports/outboxRepository";
import type { DomainEvent } from "../../../../domain/common/event";
import { opaque } from "../../execution/writeSet";
import {
  inJsonList,
  insertRowsFromJson,
  jsonList,
  jsonRows,
} from "../../sql/json";
import { int, json, text, toTimestamp } from "../../sql/row";
import type { SqlSession } from "../../sql/session";
import { type SqlRow, statement } from "../../sql/statement";
import { GLOBAL_TABLES } from "../schema";

const TABLE = GLOBAL_TABLES.outboxEvents;

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
 * `claimPending` and `pruneProcessed` are single statements with
 * `RETURNING`, which is how a driver with no interactive transaction
 * still hands out rows atomically: the same statement that takes the
 * lease is the one that reports what it took, so two workers cannot both
 * see a row as claimable.
 */
export function createD1OutboxRepository(
  deps: Readonly<{ session: SqlSession; clock: Clock }>,
): OutboxRepository {
  const { session } = deps;

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
      // A bulk insert has no single-row image, so it stages as `opaque`:
      // nothing reads the outbox back inside the unit that wrote it.
      await session.write([
        opaque(
          statement(
            insertRowsFromJson({
              table: TABLE,
              columns: [...SAVE_COLUMNS],
              conflictKey: ["id"],
              conflict: "ignore",
            }),
            jsonRows(rows),
          ),
        ),
      ]);
    },

    async claimPending(
      args: ClaimPendingArgs,
    ): Promise<readonly OutboxEntry[]> {
      if (args.limit <= 0) {
        return [];
      }
      const nowMs = args.now.getTime();
      const rows = await session.query(
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
      await session.write(mutations);
    },

    async pruneProcessed(olderThan: Date): Promise<{ deleted: number }> {
      const rows = await session.query(
        statement(
          `DELETE FROM ${TABLE}
            WHERE processed_at IS NOT NULL AND processed_at < ?
            RETURNING id`,
          toTimestamp(olderThan),
        ),
      );
      return { deleted: rows.length };
    },
  };
}
