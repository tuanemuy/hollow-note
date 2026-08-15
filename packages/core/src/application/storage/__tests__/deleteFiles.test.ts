import { ScopeKey } from "@repo/core/application/scope";
import { UserId } from "@repo/core/domain/identity/valueObject";
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
import { deleteStoredFiles } from "../deleteFiles";
import { deleteStoredObjects } from "../deleteStoredObjects";

const userId = UserId.create("user-1");
const owner = StorageOwner.user(userId);
const scope = ScopeKey.user(userId);
const CHECKSUM = Checksum.sha256("a".repeat(64));
const bytes = new TextEncoder().encode("avatar-bytes");

async function storeAvatar(h: TestHarness, n: number): Promise<StoredFileId> {
  const id = StoredFileId.create(`file-${n}`);
  const objectKey = ObjectKey.build(owner, "avatar", id, "png");
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

describe("deleteStoredFiles", () => {
  it("deletes each row and announces it with the key the object sweep needs", async () => {
    const h = createTestHarness();
    const first = await storeAvatar(h, 1);
    const second = await storeAvatar(h, 2);

    const deleted = await h.container.scopeUnitOfWorkProvider.run(
      scope,
      (ctx) =>
        deleteStoredFiles(ctx, [first, second], "deletion-1", h.clock.now()),
    );

    expect(deleted).toBe(2);
    const events = deletedEvents(h);
    expect(events).toHaveLength(2);
    expect(events[0]?.objectKey).toBe(
      ObjectKey.build(owner, "avatar", first, "png"),
    );
    expect(events[0]?.deletionOperationId).toBe("deletion-1");
  });

  it("skips ids that are already gone so a retry still succeeds", async () => {
    const h = createTestHarness();
    const id = await storeAvatar(h, 1);

    await h.container.scopeUnitOfWorkProvider.run(scope, (ctx) =>
      deleteStoredFiles(ctx, [id], null, h.clock.now()),
    );
    const again = await h.container.scopeUnitOfWorkProvider.run(scope, (ctx) =>
      deleteStoredFiles(
        ctx,
        [id, StoredFileId.create("absent")],
        null,
        h.clock.now(),
      ),
    );

    expect(again).toBe(0);
    expect(deletedEvents(h)).toHaveLength(1);
  });
});

describe("deleteStoredObjects", () => {
  it("removes the object behind a deleted row, and stays quiet on redelivery", async () => {
    const h = createTestHarness();
    const id = await storeAvatar(h, 1);
    const objectKey = ObjectKey.build(owner, "avatar", id, "png");
    await h.container.scopeUnitOfWorkProvider.run(scope, (ctx) =>
      deleteStoredFiles(ctx, [id], null, h.clock.now()),
    );
    const payload = deletedEvents(h)[0];
    if (payload === undefined) {
      throw new Error("no deletion event");
    }
    const event = {
      id: "event-1",
      type: "storage.fileDeleted",
      payload,
      occurredAt: h.clock.now(),
      aggregateId: "user:user-1",
    } as unknown as FileDeletedEvent;

    await deleteStoredObjects(event, h.workerContainer);
    expect(await h.workerContainer.objectStorage.get(objectKey)).toBeNull();

    await deleteStoredObjects(event, h.workerContainer);
  });
});
