import { beforeEach, describe, expect, it } from "vitest";
import type { DomainEvent } from "../../domain/common/event";
import { EventId } from "../../domain/common/event";
import type { ConformanceBackend, MakeConformanceBackend } from "./backend";

const LEASE_MS = 5 * 60 * 1000;

/**
 * Shared conformance suite for `OutboxRepository`: atomic claim-and-list
 * with lease-based reclaim, atomic finalize, and processed-row pruning.
 */
export function describeOutboxRepositoryContract(
  backendName: string,
  makeBackend: MakeConformanceBackend,
): void {
  describe(`OutboxRepository conformance [${backendName}]`, () => {
    let backend: ConformanceBackend;

    beforeEach(async () => {
      backend = await makeBackend();
    });

    const event = (n: number): DomainEvent => ({
      id: EventId.create(`event-${n}`),
      type: "test.event",
      payload: { n },
      occurredAt: backend.clock.now(),
      aggregateId: `aggregate-${n}`,
    });

    const claim = (workerId: string, limit = 10) =>
      backend.outboxRepository.claimPending({
        limit,
        now: backend.clock.now(),
        workerId,
        leaseMs: LEASE_MS,
      });

    it("saved events are claimable in FIFO order with attempts 0", async () => {
      await backend.outboxRepository.save([event(1)]);
      backend.clock.advance(1000);
      await backend.outboxRepository.save([event(2)]);

      const claimed = await claim("worker-a");
      expect(claimed.map((entry) => entry.id)).toEqual(["event-1", "event-2"]);
      expect(claimed[0]?.attempts).toBe(0);
      expect(claimed[0]?.payload).toEqual({ n: 1 });
    });

    it("a claimed row is invisible to a concurrent worker until the lease lapses", async () => {
      await backend.outboxRepository.save([event(1)]);
      await claim("worker-a");

      expect(await claim("worker-b")).toHaveLength(0);

      backend.clock.advance(LEASE_MS);
      const reclaimed = await claim("worker-b");
      expect(reclaimed.map((entry) => entry.id)).toEqual(["event-1"]);
    });

    it("finalize(processed) closes the row so it is never re-claimed", async () => {
      await backend.outboxRepository.save([event(1)]);
      await claim("worker-a");
      await backend.outboxRepository.finalize({
        processed: [EventId.create("event-1")],
        failures: [],
        now: backend.clock.now(),
      });

      backend.clock.advance(LEASE_MS * 2);
      expect(await claim("worker-a")).toHaveLength(0);
    });

    it("finalize(failure) schedules a retry; nextAttemptAt null quarantines", async () => {
      await backend.outboxRepository.save([event(1), event(2)]);
      await claim("worker-a");
      const retryAt = new Date(backend.clock.now().getTime() + 30_000);
      await backend.outboxRepository.finalize({
        processed: [],
        failures: [
          { id: "event-1", error: "boom", nextAttemptAt: retryAt },
          { id: "event-2", error: "poison", nextAttemptAt: null },
        ],
        now: backend.clock.now(),
      });

      expect(await claim("worker-a")).toHaveLength(0);

      backend.clock.advance(30_000);
      const due = await claim("worker-a");
      expect(due.map((entry) => entry.id)).toEqual(["event-1"]);
      expect(due[0]?.attempts).toBe(1);
    });

    it("pruneProcessed removes only processed rows older than the cutoff", async () => {
      await backend.outboxRepository.save([event(1), event(2)]);
      await claim("worker-a");
      await backend.outboxRepository.finalize({
        processed: [EventId.create("event-1")],
        failures: [],
        now: backend.clock.now(),
      });

      const cutoff = new Date(backend.clock.now().getTime() + 1);
      expect(await backend.outboxRepository.pruneProcessed(cutoff)).toEqual({
        deleted: 1,
      });

      backend.clock.advance(LEASE_MS * 2);
      const remaining = await claim("worker-b");
      expect(remaining.map((entry) => entry.id)).toEqual(["event-2"]);
    });
  });
}
