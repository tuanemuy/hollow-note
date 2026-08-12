import { EventId } from "@repo/core/domain/common/event";
import type { UserDeletedEvent } from "@repo/core/domain/identity/events";
import { UserId } from "@repo/core/domain/identity/valueObject";
import type { FileDeletedEvent } from "@repo/core/domain/storage/events";
import {
  ByteSize,
  Checksum,
  MimeType,
  ObjectKey,
  StorageOwner,
  StoredFileId,
} from "@repo/core/domain/storage/valueObject";
import { describe, expect, it } from "vitest";
import { createTestHarness } from "../../__tests__/helpers";
import {
  continuationSubscribers,
  dispatchDomainEvent,
  type EventSubscriber,
  subscribers,
} from "../subscribers";

const userDeleted = (): UserDeletedEvent => ({
  id: EventId.create("event-1"),
  type: "identity.user.deleted",
  payload: {
    userId: UserId.create("user-1"),
    deletionOperationId: "operation-1",
  },
  occurredAt: new Date("2026-01-01T00:00:00.000Z"),
  aggregateId: "user-1",
});

const OWNER = StorageOwner.user(UserId.create("user-1"));
const OBJECT_KEY = ObjectKey.build(
  OWNER,
  "avatar",
  StoredFileId.create("file-1"),
  "png",
);

const fileDeleted = (): FileDeletedEvent => ({
  id: EventId.create("event-2"),
  type: "storage.fileDeleted",
  payload: {
    fileId: StoredFileId.create("file-1"),
    owner: OWNER,
    purpose: "avatar",
    size: ByteSize.create(12),
    objectKey: OBJECT_KEY,
    deletionOperationId: null,
  },
  occurredAt: new Date("2026-01-01T00:00:00.000Z"),
  aggregateId: "user:user-1",
});

describe("dispatchDomainEvent", () => {
  it("runs every subscriber registered for the event type, in order", async () => {
    const h = createTestHarness();
    const calls: string[] = [];
    const registry: readonly EventSubscriber[] = [
      {
        eventType: "identity.user.deleted",
        consumerName: "first",
        handle: async (event) => {
          calls.push(`first:${event.payload.userId}`);
        },
      },
      {
        eventType: "identity.user.created",
        consumerName: "other-type",
        handle: async () => {
          calls.push("other-type");
        },
      },
      {
        eventType: "identity.user.deleted",
        consumerName: "second",
        handle: async () => {
          calls.push("second");
        },
      },
    ];

    await dispatchDomainEvent(userDeleted(), h.workerContainer, registry);

    expect(calls).toEqual(["first:user-1", "second"]);
  });

  it("acknowledges an event with no subscriber and warns instead of throwing", async () => {
    const h = createTestHarness();

    await dispatchDomainEvent(userDeleted(), h.workerContainer, []);

    expect(h.logger.byLevel("warn").map((entry) => entry.message)).toContain(
      "[subscribers] no subscriber for identity.user.deleted",
    );
  });

  it("propagates a subscriber failure so the relay retries the delivery", async () => {
    const h = createTestHarness();
    const registry: readonly EventSubscriber[] = [
      {
        eventType: "identity.user.deleted",
        consumerName: "boom",
        handle: async () => {
          throw new Error("boom");
        },
      },
    ];

    await expect(
      dispatchDomainEvent(userDeleted(), h.workerContainer, registry),
    ).rejects.toThrow("boom");
  });

  it("reclaims the object of a deleted file through the default registry", async () => {
    const h = createTestHarness();
    const bytes = new TextEncoder().encode("avatar-bytes");
    await h.workerContainer.objectStorage.put(OBJECT_KEY, bytes, {
      mimeType: MimeType.create("image/png"),
      size: ByteSize.create(bytes.byteLength),
      checksum: Checksum.sha256("a".repeat(64)),
    });

    await dispatchDomainEvent(fileDeleted(), h.workerContainer);

    expect(await h.workerContainer.objectStorage.get(OBJECT_KEY)).toBeNull();
    expect(h.logger.byLevel("warn")).toHaveLength(0);
  });

  it("registers every subscriber under a unique consumer name per event type", () => {
    const keys = subscribers.map(
      (subscriber) => `${subscriber.eventType}:${subscriber.consumerName}`,
    );
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("dispatches every continuation type, so no continuation chain stops at a warning", () => {
    const registered = new Set<string>(
      subscribers.map((subscriber) => subscriber.eventType),
    );
    const continuationTypes = Object.keys(continuationSubscribers);

    expect(continuationTypes).not.toHaveLength(0);
    expect(
      continuationTypes.filter((type) => !registered.has(type)),
    ).toHaveLength(0);
  });
});
