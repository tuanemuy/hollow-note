import type { FileDeletedEvent } from "@repo/core/domain/storage/events";
import type { WorkerContainer } from "../di/types";

/**
 * Reclaims the object behind a deleted stored-file row.
 *
 * Metadata and object cannot share a transaction, so the row goes first
 * and the object follows here; an object left behind by a lost delivery
 * is harmless because nothing references it.
 *
 * Idempotence basis (no `IdempotencyStore`): deleting a key is
 * idempotent, and the key travels in the event, so a redelivery neither
 * needs the row back nor does anything new.
 */
export async function deleteStoredObjects(
  event: FileDeletedEvent,
  deps: WorkerContainer,
): Promise<void> {
  await deps.objectStorage.deleteMany([event.payload.objectKey]);
}
