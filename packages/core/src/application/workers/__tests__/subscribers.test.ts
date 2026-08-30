import { ScopeKey } from "@repo/core/application/scope";
import { EventId } from "@repo/core/domain/common/event";
import type { UserDeletedEvent } from "@repo/core/domain/identity/events";
import { UserId } from "@repo/core/domain/identity/valueObject";
import { BackupRecord } from "@repo/core/domain/integration/backupRecord";
import type { NotePurgedEvent } from "@repo/core/domain/note/events";
import { NoteId, NoteOwner } from "@repo/core/domain/note/valueObject";
import type { FileDeletedEvent } from "@repo/core/domain/storage/events";
import { StoredFile } from "@repo/core/domain/storage/storedFile";
import {
  ByteSize,
  Checksum,
  MimeType,
  ObjectKey,
  StorageOwner,
  StoredFileId,
} from "@repo/core/domain/storage/valueObject";
import { TagAssignment } from "@repo/core/domain/tag/tagAssignment";
import { describe, expect, it } from "vitest";
import { createTestHarness, type TestHarness } from "../../__tests__/helpers";
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

const PURGED_NOTE = NoteId.create("note-1");
const PURGE_SCOPE = ScopeKey.user(UserId.create("user-1"));

const notePurged = (): NotePurgedEvent => ({
  id: EventId.create("event-3"),
  type: "note.purged",
  payload: {
    noteId: PURGED_NOTE,
    owner: NoteOwner.user(UserId.create("user-1")),
    sourceFileId: StoredFileId.create("file-1"),
    operationId: "purge-note-1",
    deletionOperationId: null,
    routeVersion: 1,
    projectionRevision: 1,
  },
  occurredAt: new Date("2026-01-01T00:00:00.000Z"),
  aggregateId: "note-1",
});

async function seedPurgeResidue(h: TestHarness): Promise<void> {
  await h.container.scopeUnitOfWorkProvider.run(PURGE_SCOPE, async (ctx) => {
    await ctx.storedFileRepository.insert(
      StoredFile.register(
        {
          id: "file-1",
          owner: OWNER,
          objectKey: ObjectKey.build(
            OWNER,
            "source",
            StoredFileId.create("file-1"),
            "html",
          ),
          fileName: "file-1.html",
          mimeType: "text/html",
          size: 10,
          checksum: Checksum.sha256("a".repeat(64)),
          purpose: "source",
          noteId: PURGED_NOTE,
          uploadedBy: UserId.create("user-1"),
        },
        h.clock.now(),
      ).entity,
    );
    await ctx.tagAssignmentRepository.insert(
      TagAssignment.reconstruct({
        id: "assignment-1",
        tagId: "tag-1",
        noteId: PURGED_NOTE,
        scopeType: "user",
        scopeId: "user-1",
        assignedBy: "user-1",
        assignedAt: h.clock.now(),
      }),
    );
    await ctx.backupRecordRepository.insert(
      BackupRecord.reconstruct({
        id: "backup-1",
        userId: "user-1",
        noteId: PURGED_NOTE,
        sourceFileId: "file-1",
        externalFileId: "drive-1",
        webViewUrl: "https://drive.example.test/1",
        checksumValue: "c".repeat(64),
        version: 0,
        backedUpAt: h.clock.now(),
        updatedAt: h.clock.now(),
      }),
    );
  });
}

const residueCounts = (h: TestHarness) => {
  const store = h.backend.scope(PURGE_SCOPE);
  return {
    files: store.storedFiles.values().length,
    assignments: store.tagAssignments.values().length,
    backups: store.backupRecords.values().length,
  };
};

describe("note.purged fan-out", () => {
  // The dispatcher acknowledges an unsubscribed event with nothing but a
  // warning, so a follower that is written and never registered leaves
  // every other test green. The registration itself is the assertion.
  it("registers one subscriber per follower, so no leg of the purge is acknowledged with a warning", () => {
    expect(
      subscribers
        .filter((subscriber) => subscriber.eventType === "note.purged")
        .map((subscriber) => subscriber.consumerName)
        .sort(),
    ).toEqual([
      "integration.deleteBackupRecordsForNote",
      "storage.deleteFilesForNote",
      "tag.deleteAssignmentsForNote",
    ]);
  });

  it("clears the files, assignments and backup records of the purged note through the default registry, and stays a no-op on redelivery", async () => {
    const h = createTestHarness();
    await seedPurgeResidue(h);
    expect(residueCounts(h)).toEqual({
      files: 1,
      assignments: 1,
      backups: 1,
    });

    await dispatchDomainEvent(notePurged(), h.workerContainer);

    expect(residueCounts(h)).toEqual({
      files: 0,
      assignments: 0,
      backups: 0,
    });
    expect(h.logger.byLevel("warn")).toHaveLength(0);
    const afterFirst = h.backend.outbox.values().length;

    await dispatchDomainEvent(notePurged(), h.workerContainer);

    expect(residueCounts(h)).toEqual({
      files: 0,
      assignments: 0,
      backups: 0,
    });
    // The second delivery announces nothing new: every follower found
    // its rows already gone.
    expect(h.backend.outbox.values()).toHaveLength(afterFirst);
  });
});
