import type {
  ClaimPendingArgs,
  FinalizeOutboxArgs,
  OutboxEntry,
  OutboxRepository,
} from "../../../application/ports/outboxRepository";
import type { DomainEvent } from "../../../domain/common/event";
import type { MemoryBackend, OutboxRow } from "../store";
import { clone, compareStrings } from "../support";

export function createMemoryOutboxRepository(
  backend: MemoryBackend,
): OutboxRepository {
  const table = backend.outbox;

  const toEntry = (row: OutboxRow): OutboxEntry => ({
    id: row.id,
    type: row.type,
    payload: clone(row.payload),
    occurredAt: row.occurredAt,
    aggregateId: row.aggregateId,
    attempts: row.attempts,
  });

  return {
    async save(events: readonly DomainEvent[]): Promise<void> {
      const createdAt = backend.clock.now();
      for (const event of events) {
        if (table.has(event.id)) continue;
        table.set(event.id, {
          id: event.id,
          type: event.type,
          payload: clone(event.payload),
          occurredAt: event.occurredAt,
          aggregateId: event.aggregateId,
          createdAt,
          attempts: 0,
          processedAt: null,
          failedAt: null,
          nextAttemptAt: null,
          claimedAt: null,
          claimedBy: null,
          lastError: null,
        });
      }
    },

    async claimPending(
      args: ClaimPendingArgs,
    ): Promise<readonly OutboxEntry[]> {
      const nowMs = args.now.getTime();
      const claimable = table
        .values()
        .filter(
          (row) =>
            row.processedAt === null &&
            row.failedAt === null &&
            (row.nextAttemptAt === null ||
              row.nextAttemptAt.getTime() <= nowMs) &&
            (row.claimedAt === null ||
              row.claimedAt.getTime() <= nowMs - args.leaseMs),
        )
        .sort(
          (a, b) =>
            a.createdAt.getTime() - b.createdAt.getTime() ||
            compareStrings(a.id, b.id),
        )
        .slice(0, Math.max(0, args.limit));
      for (const row of claimable) {
        table.set(row.id, {
          ...row,
          claimedAt: args.now,
          claimedBy: args.workerId,
        });
      }
      return claimable.map(toEntry);
    },

    async finalize(args: FinalizeOutboxArgs): Promise<void> {
      for (const id of args.processed) {
        const row = table.get(id);
        if (row !== undefined) {
          table.set(id, {
            ...row,
            processedAt: args.now,
            claimedAt: null,
            claimedBy: null,
          });
        }
      }
      for (const failure of args.failures) {
        const row = table.get(failure.id);
        if (row !== undefined) {
          table.set(failure.id, {
            ...row,
            attempts: row.attempts + 1,
            lastError: failure.error,
            nextAttemptAt: failure.nextAttemptAt,
            failedAt: failure.nextAttemptAt === null ? args.now : null,
            claimedAt: null,
            claimedBy: null,
          });
        }
      }
    },

    async pruneProcessed(olderThan: Date): Promise<{ deleted: number }> {
      const targets = table
        .values()
        .filter(
          (row) =>
            row.processedAt !== null &&
            row.processedAt.getTime() < olderThan.getTime(),
        );
      for (const row of targets) {
        table.delete(row.id);
      }
      return { deleted: targets.length };
    },
  };
}
