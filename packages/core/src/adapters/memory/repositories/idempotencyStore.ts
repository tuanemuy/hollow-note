import type { IdempotencyStore } from "../../../application/ports/idempotencyStore";
import type { EventId } from "../../../domain/common/event";
import type { MemoryBackend } from "../store";

export function createMemoryIdempotencyStore(
  backend: MemoryBackend,
): IdempotencyStore {
  return {
    // Synchronous check-and-set: concurrent callers for the same pair
    // observe exactly one `true`.
    async markProcessed(consumer: string, eventId: EventId): Promise<boolean> {
      const key = `${consumer} ${eventId}`;
      if (backend.idempotency.has(key)) {
        return false;
      }
      backend.idempotency.set(key, true);
      return true;
    },
  };
}
