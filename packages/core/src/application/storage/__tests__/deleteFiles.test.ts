import {
  isSystemError,
  SystemError,
  SystemErrorCode,
} from "@repo/core/application/errors";
import type { ObjectStorage } from "@repo/core/application/ports/objectStorage";
import { ScopeKey } from "@repo/core/application/scope";
import { EventId } from "@repo/core/domain/common/event";
import { UserId } from "@repo/core/domain/identity/valueObject";
import { NoteId } from "@repo/core/domain/note/valueObject";
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
import { describe, expect, it } from "vitest";
import { createTestHarness, type TestHarness } from "../../__tests__/helpers";
import { dispatchDomainEvent } from "../../workers/subscribers";
import { deleteStoredFiles } from "../deleteFiles";
import { deleteFilesByOwner } from "../deleteFilesByOwner";
import { deleteFilesForNote } from "../deleteFilesForNote";
import { deleteStoredObjects } from "../deleteStoredObjects";

const userId = UserId.create("user-1");
const owner = StorageOwner.user(userId);
const scope = ScopeKey.user(userId);
const CHECKSUM = Checksum.sha256("a".repeat(64));
const bytes = new TextEncoder().encode("avatar-bytes");

const keyOf = (id: StoredFileId): ObjectKey =>
  ObjectKey.build(owner, "avatar", id, "png");

async function storeAvatar(h: TestHarness, n: number): Promise<StoredFileId> {
  const id = StoredFileId.create(`file-${n}`);
  const objectKey = keyOf(id);
  await h.workerContainer.objectStorage.put(objectKey, bytes, {
    mimeType: MimeType.create("image/png"),
    size: ByteSize.create(bytes.byteLength),
    checksum: CHECKSUM,
  });
  await h.container.scopeUnitOfWorkProvider.run(scope, async (ctx) => {
    const registered = StoredFile.register(
      {
        id,
        owner,
        objectKey,
        fileName: `avatar-${n}.png`,
        mimeType: "image/png",
        size: bytes.byteLength,
        checksum: CHECKSUM,
        purpose: "avatar",
        noteId: null,
        uploadedBy: userId,
      },
      h.clock.now(),
    );
    await ctx.storedFileRepository.insert(registered.entity);
    ctx.collectEvents(registered.eventDrafts);
  });
  return id;
}

const deletedEvents = (
  h: TestHarness,
): readonly FileDeletedEvent["payload"][] =>
  h.backend.outbox
    .values()
    .filter((row) => row.type === "storage.fileDeleted")
    .map((row) => row.payload as FileDeletedEvent["payload"]);

const asEvent = (
  payload: FileDeletedEvent["payload"],
  id: string,
): FileDeletedEvent => ({
  id: EventId.create(id),
  type: "storage.fileDeleted",
  payload,
  occurredAt: new Date("2026-01-01T00:00:00.000Z"),
  aggregateId: "user:user-1",
});

describe("deleteStoredFiles", () => {
  it("TC-storage-030 / TC-storage-035: deletes each row and announces it with the key the object sweep needs", async () => {
    const h = createTestHarness();
    const first = await storeAvatar(h, 1);
    const second = await storeAvatar(h, 2);
    const third = await storeAvatar(h, 3);

    const deleted = await h.container.scopeUnitOfWorkProvider.run(
      scope,
      (ctx) =>
        deleteStoredFiles(
          ctx,
          [first, second, third],
          "deletion-1",
          h.clock.now(),
        ),
    );

    expect(deleted).toBe(3);
    const events = deletedEvents(h);
    expect(events.map((payload) => payload.objectKey)).toEqual([
      keyOf(first),
      keyOf(second),
      keyOf(third),
    ]);
    expect(events[0]?.deletionOperationId).toBe("deletion-1");
  });

  it("TC-storage-031: skips ids that are already gone so a retry still succeeds", async () => {
    const h = createTestHarness();
    const id = await storeAvatar(h, 1);
    const survivor = await storeAvatar(h, 2);

    await h.container.scopeUnitOfWorkProvider.run(scope, (ctx) =>
      deleteStoredFiles(ctx, [id], null, h.clock.now()),
    );
    const again = await h.container.scopeUnitOfWorkProvider.run(scope, (ctx) =>
      deleteStoredFiles(
        ctx,
        [id, StoredFileId.create("absent"), survivor],
        null,
        h.clock.now(),
      ),
    );

    expect(again).toBe(1);
    expect(deletedEvents(h).map((payload) => payload.fileId)).toEqual([
      id,
      survivor,
    ]);
  });

  it("TC-storage-032: answers 0 for an empty id list without announcing anything", async () => {
    const h = createTestHarness();
    await storeAvatar(h, 1);

    const deleted = await h.container.scopeUnitOfWorkProvider.run(
      scope,
      (ctx) => deleteStoredFiles(ctx, [], null, h.clock.now()),
    );

    expect(deleted).toBe(0);
    expect(deletedEvents(h)).toEqual([]);
    expect(h.backend.scope(scope).storedFiles.values()).toHaveLength(1);
  });

  it("TC-storage-033: hands the quota subscriber the owner and size of every row it removed", async () => {
    const h = createTestHarness();
    const id = await storeAvatar(h, 1);

    await h.container.scopeUnitOfWorkProvider.run(scope, (ctx) =>
      deleteStoredFiles(ctx, [id], null, h.clock.now()),
    );

    expect(
      deletedEvents(h).map((payload) => ({
        owner: payload.owner,
        size: payload.size as number,
      })),
    ).toEqual([{ owner, size: bytes.byteLength }]);
  });

  it("TC-storage-034: leaves the object itself to the `storage.fileDeleted` subscriber", async () => {
    const h = createTestHarness();
    const id = await storeAvatar(h, 1);

    await h.container.scopeUnitOfWorkProvider.run(scope, (ctx) =>
      deleteStoredFiles(ctx, [id], null, h.clock.now()),
    );

    // Metadata and object cannot share a transaction, so the bytes
    // outlive the row until the subscriber runs.
    expect(await h.workerContainer.objectStorage.get(keyOf(id))).not.toBeNull();
    const payload = deletedEvents(h)[0];
    if (payload === undefined) {
      throw new Error("no deletion event");
    }
    await dispatchDomainEvent(asEvent(payload, "event-1"), h.workerContainer);
    expect(await h.workerContainer.objectStorage.get(keyOf(id))).toBeNull();
  });

  it("TC-storage-036: announces one deletion per file however often the id is deleted", async () => {
    const h = createTestHarness();
    const id = await storeAvatar(h, 1);

    const first = await h.container.scopeUnitOfWorkProvider.run(scope, (ctx) =>
      deleteStoredFiles(ctx, [id], null, h.clock.now()),
    );
    const second = await h.container.scopeUnitOfWorkProvider.run(scope, (ctx) =>
      deleteStoredFiles(ctx, [id], null, h.clock.now()),
    );

    expect([first, second]).toEqual([1, 0]);
    // One event per file, so a subscriber that subtracts a size cannot
    // subtract it twice.
    expect(deletedEvents(h)).toHaveLength(1);
  });
});

// TC-storage-074 lands with Usage's `applyStorageDelta` subscriber
// (UC-usage-003, issue #6), which is the second consumer that row is
// about. The half this slice owns is fixed below: `deleteStoredObjects`
// marks no delivery processed (TC-storage-069 / TC-storage-070).
describe("deleteStoredObjects", () => {
  it("TC-storage-063: reclaims the object of every delivered event", async () => {
    const h = createTestHarness();
    const ids = [
      await storeAvatar(h, 1),
      await storeAvatar(h, 2),
      await storeAvatar(h, 3),
    ];
    await h.container.scopeUnitOfWorkProvider.run(scope, (ctx) =>
      deleteStoredFiles(ctx, ids, null, h.clock.now()),
    );

    const payloads = deletedEvents(h);
    for (const [index, payload] of payloads.entries()) {
      await deleteStoredObjects(
        asEvent(payload, `event-${index}`),
        h.workerContainer,
      );
    }

    expect(payloads).toHaveLength(3);
    for (const id of ids) {
      expect(await h.workerContainer.objectStorage.get(keyOf(id))).toBeNull();
    }
  });

  it("TC-storage-064: resolves the key from the event, since the metadata row is already gone", async () => {
    const h = createTestHarness();
    const id = await storeAvatar(h, 1);
    await h.container.scopeUnitOfWorkProvider.run(scope, (ctx) =>
      deleteStoredFiles(ctx, [id], null, h.clock.now()),
    );
    const payload = deletedEvents(h)[0];
    if (payload === undefined) {
      throw new Error("no deletion event");
    }
    // Nothing could look the key up any more.
    expect(h.backend.scope(scope).storedFiles.get(id)).toBeUndefined();

    await deleteStoredObjects(asEvent(payload, "event-1"), h.workerContainer);

    expect(await h.workerContainer.objectStorage.get(keyOf(id))).toBeNull();
  });

  it("TC-storage-065 / TC-storage-068: treats an already-absent key as success, so a redelivery changes nothing", async () => {
    const h = createTestHarness();
    const id = await storeAvatar(h, 1);
    await h.container.scopeUnitOfWorkProvider.run(scope, (ctx) =>
      deleteStoredFiles(ctx, [id], null, h.clock.now()),
    );
    const payload = deletedEvents(h)[0];
    if (payload === undefined) {
      throw new Error("no deletion event");
    }
    const event = asEvent(payload, "event-1");

    await deleteStoredObjects(event, h.workerContainer);
    await expect(
      deleteStoredObjects(event, h.workerContainer),
    ).resolves.toBeUndefined();
    expect(h.backend.objects.values()).toEqual([]);
  });

  it("TC-storage-066 / TC-storage-067: isolates the key that fails, leaving its own event for redelivery while the others are reclaimed", async () => {
    const h = createTestHarness();
    const ids = [
      await storeAvatar(h, 1),
      await storeAvatar(h, 2),
      await storeAvatar(h, 3),
    ];
    await h.container.scopeUnitOfWorkProvider.run(scope, (ctx) =>
      deleteStoredFiles(ctx, ids, null, h.clock.now()),
    );
    const doomed = keyOf(ids[1] as StoredFileId);
    const real = h.workerContainer.objectStorage;
    const flaky: ObjectStorage = {
      ...real,
      async deleteMany(keys) {
        if (keys.includes(doomed)) {
          throw new SystemError(
            SystemErrorCode.ExternalApiError,
            "object store refused the delete",
          );
        }
        await real.deleteMany(keys);
      },
    };
    const container = { ...h.workerContainer, objectStorage: flaky };

    const outcomes = await Promise.all(
      deletedEvents(h).map((payload, index) =>
        deleteStoredObjects(asEvent(payload, `event-${index}`), container).then(
          () => "ok",
          () => "failed",
        ),
      ),
    );

    expect(outcomes).toEqual(["ok", "failed", "ok"]);
    // The two that went are gone; the one that failed is still there for
    // the next delivery to try again.
    expect(await real.get(keyOf(ids[0] as StoredFileId))).toBeNull();
    expect(await real.get(doomed)).not.toBeNull();
    expect(await real.get(keyOf(ids[2] as StoredFileId))).toBeNull();
  });

  it("TC-storage-069 / TC-storage-070: records nothing as processed, so a delivery that failed is not filtered out on retry", async () => {
    const h = createTestHarness();
    const id = await storeAvatar(h, 1);
    await h.container.scopeUnitOfWorkProvider.run(scope, (ctx) =>
      deleteStoredFiles(ctx, [id], null, h.clock.now()),
    );
    const payload = deletedEvents(h)[0];
    if (payload === undefined) {
      throw new Error("no deletion event");
    }
    const event = asEvent(payload, "event-1");
    const real = h.workerContainer.objectStorage;
    let attempts = 0;
    const flaky: ObjectStorage = {
      ...real,
      async deleteMany(keys) {
        attempts += 1;
        if (attempts === 1) {
          throw new SystemError(SystemErrorCode.ExternalApiError, "boom");
        }
        await real.deleteMany(keys);
      },
    };

    await expect(
      deleteStoredObjects(event, {
        ...h.workerContainer,
        objectStorage: flaky,
      }),
    ).rejects.toThrow();
    // Nothing was written to the idempotency store, so the retry is not
    // rejected as a duplicate.
    expect(h.backend.idempotency.values()).toEqual([]);

    await deleteStoredObjects(event, {
      ...h.workerContainer,
      objectStorage: flaky,
    });
    expect(await real.get(keyOf(id))).toBeNull();
  });

  it("TC-storage-071: leaves an unreclaimable object as an orphan nothing references", async () => {
    const h = createTestHarness();
    const id = await storeAvatar(h, 1);
    await h.container.scopeUnitOfWorkProvider.run(scope, (ctx) =>
      deleteStoredFiles(ctx, [id], null, h.clock.now()),
    );
    const payload = deletedEvents(h)[0];
    if (payload === undefined) {
      throw new Error("no deletion event");
    }
    const dead: ObjectStorage = {
      ...h.workerContainer.objectStorage,
      deleteMany: () =>
        Promise.reject(
          new SystemError(SystemErrorCode.ExternalApiError, "always fails"),
        ),
    };

    await expect(
      deleteStoredObjects(asEvent(payload, "event-1"), {
        ...h.workerContainer,
        objectStorage: dead,
      }),
    ).rejects.toThrow();

    expect(await h.workerContainer.objectStorage.get(keyOf(id))).not.toBeNull();
    // No metadata row points at it, so nothing can reach it.
    expect(h.backend.scope(scope).storedFiles.values()).toEqual([]);
  });

  it("TC-storage-072: lets an object-store failure through so the relay redelivers", async () => {
    const h = createTestHarness();
    const id = await storeAvatar(h, 1);
    await h.container.scopeUnitOfWorkProvider.run(scope, (ctx) =>
      deleteStoredFiles(ctx, [id], null, h.clock.now()),
    );
    const payload = deletedEvents(h)[0];
    if (payload === undefined) {
      throw new Error("no deletion event");
    }

    const error = await deleteStoredObjects(asEvent(payload, "event-1"), {
      ...h.workerContainer,
      objectStorage: {
        ...h.workerContainer.objectStorage,
        deleteMany: () =>
          Promise.reject(
            new SystemError(SystemErrorCode.ExternalApiError, "no permission"),
          ),
      },
    }).then(
      () => null,
      (thrown: unknown) => thrown,
    );

    expect(isSystemError(error)).toBe(true);
    expect(isSystemError(error) && error.code).toBe(
      SystemErrorCode.ExternalApiError,
    );
  });

  it("TC-storage-073: touches the object store only for a `storage.fileDeleted` delivery", async () => {
    const h = createTestHarness();
    const id = await storeAvatar(h, 1);
    let calls = 0;
    const counting: ObjectStorage = {
      ...h.workerContainer.objectStorage,
      async deleteMany(keys) {
        calls += 1;
        await h.workerContainer.objectStorage.deleteMany(keys);
      },
    };
    // A file was stored, but nothing has been deleted, so the outbox
    // carries no `storage.fileDeleted` for this subscriber to receive.
    expect(deletedEvents(h)).toEqual([]);

    for (const payload of deletedEvents(h)) {
      await deleteStoredObjects(asEvent(payload, "event-0"), {
        ...h.workerContainer,
        objectStorage: counting,
      });
    }

    expect(calls).toBe(0);
    expect(await h.workerContainer.objectStorage.get(keyOf(id))).not.toBeNull();
  });

  it("TC-storage-075: is the single reclamation path — every deleting usecase only announces `storage.fileDeleted`", async () => {
    const h = createTestHarness();
    const inline = await storeAvatar(h, 1);
    await h.container.scopeUnitOfWorkProvider.run(scope, (ctx) =>
      deleteStoredFiles(ctx, [inline], null, h.clock.now()),
    );

    const noteFile = StoredFileId.create("file-note");
    const noteKey = ObjectKey.build(owner, "media", noteFile, "png");
    await h.workerContainer.objectStorage.put(noteKey, bytes, {
      mimeType: MimeType.create("image/png"),
      size: ByteSize.create(bytes.byteLength),
      checksum: CHECKSUM,
    });
    await h.container.scopeUnitOfWorkProvider.run(scope, (ctx) =>
      ctx.storedFileRepository.insert(
        StoredFile.register(
          {
            id: noteFile,
            owner,
            objectKey: noteKey,
            fileName: "file-note.png",
            mimeType: "image/png",
            size: bytes.byteLength,
            checksum: CHECKSUM,
            purpose: "media",
            noteId: NoteId.create("note-1"),
            uploadedBy: userId,
          },
          h.clock.now(),
        ).entity,
      ),
    );
    await deleteFilesForNote({
      container: h.workerContainer,
      input: {
        noteId: NoteId.create("note-1"),
        scope,
        operationId: "purge-note-1",
        deletionOperationId: null,
      },
    });

    const ownerFile = await storeAvatar(h, 2);
    await h.container.scopeUnitOfWorkProvider.run(scope, (ctx) =>
      ctx.cleanupAdmission.beginPersonalAccountDeletion("deletion-1", userId),
    );
    await deleteFilesByOwner({
      container: h.workerContainer,
      input: { deletionOperationId: "deletion-1", scope },
    });

    // All three routes left their objects in place and announced the
    // same event; the subscriber is what removes the bytes.
    const keys = [keyOf(inline), noteKey, keyOf(ownerFile)];
    expect(
      deletedEvents(h)
        .map((payload) => payload.objectKey)
        .sort(),
    ).toEqual([...keys].sort());
    for (const key of keys) {
      expect(await h.workerContainer.objectStorage.get(key)).not.toBeNull();
    }
    for (const [index, payload] of deletedEvents(h).entries()) {
      await deleteStoredObjects(
        asEvent(payload, `event-${index}`),
        h.workerContainer,
      );
    }
    for (const key of keys) {
      expect(await h.workerContainer.objectStorage.get(key)).toBeNull();
    }
  });
});
