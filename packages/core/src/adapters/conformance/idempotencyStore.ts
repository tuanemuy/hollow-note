import { beforeEach, describe, expect, it } from "vitest";
import { EventId } from "../../domain/common/event";
import type { ConformanceBackend, MakeConformanceBackend } from "./backend";

/** Shared conformance suite for `IdempotencyStore` (ADP-common-039). */
export function describeIdempotencyStoreContract(
  backendName: string,
  makeBackend: MakeConformanceBackend,
): void {
  describe(`IdempotencyStore conformance [${backendName}]`, () => {
    let backend: ConformanceBackend;

    beforeEach(async () => {
      backend = await makeBackend();
    });

    it("ADP-common-039: first mark returns true, duplicates return false", async () => {
      const eventId = EventId.create("event-1");
      expect(
        await backend.idempotencyStore.markProcessed("consumer-a", eventId),
      ).toBe(true);
      expect(
        await backend.idempotencyStore.markProcessed("consumer-a", eventId),
      ).toBe(false);
    });

    it("ADP-common-039: the record is scoped per consumer", async () => {
      const eventId = EventId.create("event-1");
      await backend.idempotencyStore.markProcessed("consumer-a", eventId);
      expect(
        await backend.idempotencyStore.markProcessed("consumer-b", eventId),
      ).toBe(true);
    });

    it("ADP-common-039: concurrent callers observe exactly one true", async () => {
      const eventId = EventId.create("event-1");
      const results = await Promise.all(
        Array.from({ length: 5 }, () =>
          backend.idempotencyStore.markProcessed("consumer-a", eventId),
        ),
      );
      expect(results.filter((result) => result)).toHaveLength(1);
    });
  });
}
