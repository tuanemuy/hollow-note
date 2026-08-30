import { isConflictError } from "@repo/core/application/errors";
import { ScopeTaskPriority } from "@repo/core/application/ports/scopeTaskScheduler";
import { ScopeKey } from "@repo/core/application/scope";
import { Version } from "@repo/core/domain/common/version";
import { UserId } from "@repo/core/domain/identity/valueObject";
import { NoteId } from "@repo/core/domain/note/valueObject";
import type { FileDeletedEvent } from "@repo/core/domain/storage/events";
import type { EphemeralFile } from "@repo/core/domain/storage/storedFile";
import { StoredFile } from "@repo/core/domain/storage/storedFile";
import {
  ByteSize,
  Checksum,
  FileName,
  type FilePurpose,
  MimeType,
  ObjectKey,
  StorageOwner,
  StoredFileId,
} from "@repo/core/domain/storage/valueObject";
import { describe, expect, it } from "vitest";
import { createTestHarness, type TestHarness } from "../../__tests__/helpers";
import { runDueScopeTasks } from "../../workers/scopeTaskRunner";
import {
  deleteFilesForNote,
  NOTE_FILE_DELETE_BATCH_SIZE,
  NOTE_FILE_DELETE_TASK_KIND,
} from "../deleteFilesForNote";
import { deleteStoredObjects } from "../deleteStoredObjects";

const userId = UserId.create("user-1");
const owner = StorageOwner.user(userId);
const scope = ScopeKey.user(userId);
const NOTE = NoteId.create("note-1");
const OTHER_NOTE = NoteId.create("note-2");
const PURGE_OPERATION = "purge-note-1";
const DELETION_OPERATION = "deletion-1";
const CHECKSUM = Checksum.sha256("a".repeat(64));
const bytes = new TextEncoder().encode("payload");

const objectKeyOf = (id: string, purpose: FilePurpose): ObjectKey =>
  ObjectKey.build(owner, purpose, StoredFileId.create(id), "png");

async function seedFile(
  h: TestHarness,
  params: Readonly<{
    id: string;
    purpose: "source" | "media" | "reference";
    noteId?: NoteId;
    size?: number;
  }>,
): Promise<StoredFileId> {
  const fileId = StoredFileId.create(params.id);
  const objectKey = objectKeyOf(params.id, params.purpose);
  await h.workerContainer.objectStorage.put(objectKey, bytes, {
    mimeType: MimeType.create("image/png"),
    size: ByteSize.create(bytes.byteLength),
    checksum: CHECKSUM,
  });
  await h.container.scopeUnitOfWorkProvider.run(scope, (ctx) =>
    ctx.storedFileRepository.insert(
      StoredFile.register(
        {
          id: params.id,
          owner,
          objectKey,
          fileName: `${params.id}.png`,
          mimeType: "image/png",
          size: params.size ?? 10,
          checksum: CHECKSUM,
          purpose: params.purpose,
          noteId: params.noteId ?? NOTE,
          uploadedBy: userId,
        },
        h.clock.now(),
      ).entity,
    ),
  );
  return fileId;
}

async function seedAvatar(h: TestHarness, id: string): Promise<void> {
  await h.container.scopeUnitOfWorkProvider.run(scope, (ctx) =>
    ctx.storedFileRepository.insert(
      StoredFile.register(
        {
          id,
          owner,
          objectKey: objectKeyOf(id, "avatar"),
          fileName: `${id}.png`,
          mimeType: "image/png",
          size: 10,
          checksum: CHECKSUM,
          purpose: "avatar",
          noteId: null,
          uploadedBy: userId,
        },
        h.clock.now(),
      ).entity,
    ),
  );
}

/** No registration path mints an artifact, so its ephemeral row is built here. */
async function seedArtifact(h: TestHarness, id: string): Promise<void> {
  const now = h.clock.now();
  const file: EphemeralFile = {
    id: StoredFileId.create(id),
    owner,
    objectKey: objectKeyOf(id, "artifact"),
    fileName: FileName.create(`${id}.pdf`),
    mimeType: MimeType.create("application/pdf"),
    size: ByteSize.create(64),
    checksum: CHECKSUM,
    version: Version.initial(),
    createdAt: now,
    updatedAt: now,
    retention: "ephemeral",
    expiresAt: new Date(now.getTime() + 60_000),
    purpose: "artifact",
    noteId: NOTE,
    noteVersion: 1,
    uploadedBy: userId,
  };
  await h.container.scopeUnitOfWorkProvider.run(scope, (ctx) =>
    ctx.storedFileRepository.insert(file),
  );
}

const openBarrier = (h: TestHarness) =>
  h.container.scopeUnitOfWorkProvider.run(scope, (ctx) =>
    ctx.cleanupAdmission.beginPersonalAccountDeletion(
      DELETION_OPERATION,
      userId,
    ),
  );

const run = (
  h: TestHarness,
  deletionOperationId: string | null = null,
  noteId: NoteId = NOTE,
) =>
  deleteFilesForNote({
    container: h.workerContainer,
    input: {
      noteId,
      scope,
      operationId: PURGE_OPERATION,
      deletionOperationId,
    },
  });

const deletionEvents = (
  h: TestHarness,
): readonly FileDeletedEvent["payload"][] =>
  h.backend.outbox
    .values()
    .filter((row) => row.type === "storage.fileDeleted")
    .map((row) => row.payload as FileDeletedEvent["payload"]);

const storedIds = (h: TestHarness): readonly string[] =>
  h.backend
    .scope(scope)
    .storedFiles.values()
    .map((file) => file.id)
    .sort();

const tasks = (h: TestHarness) =>
  h.backend.scope(scope).scheduledTasks.values();

describe("deleteFilesForNote", () => {
  it("TC-storage-051: deletes the note's source, media and reference rows and announces each one", async () => {
    const h = createTestHarness();
    await seedFile(h, { id: "file-1", purpose: "source" });
    await seedFile(h, { id: "file-2", purpose: "media" });
    await seedFile(h, { id: "file-3", purpose: "media" });
    await seedFile(h, { id: "file-4", purpose: "reference" });

    const view = await run(h);

    expect(view.deletedCount).toBe(4);
    expect(storedIds(h)).toEqual([]);
    expect(
      deletionEvents(h)
        .map((payload) => payload.fileId)
        .sort(),
    ).toEqual(["file-1", "file-2", "file-3", "file-4"]);
  });

  it("TC-storage-052: leaves an artifact of the same note to its own expiry", async () => {
    const h = createTestHarness();
    await seedFile(h, { id: "file-1", purpose: "media" });
    await seedArtifact(h, "file-artifact");

    const view = await run(h);

    expect(view.deletedCount).toBe(1);
    expect(storedIds(h)).toEqual(["file-artifact"]);
    expect(deletionEvents(h)).toHaveLength(1);
  });

  it("TC-storage-053: leaves another note's media alone", async () => {
    const h = createTestHarness();
    await seedFile(h, { id: "file-1", purpose: "media" });
    await seedFile(h, { id: "file-2", purpose: "media", noteId: OTHER_NOTE });

    const view = await run(h);

    expect(view.deletedCount).toBe(1);
    expect(storedIds(h)).toEqual(["file-2"]);
  });

  it("TC-storage-054: leaves the owner's avatar alone, since it belongs to no note", async () => {
    const h = createTestHarness();
    await seedFile(h, { id: "file-1", purpose: "media" });
    await seedAvatar(h, "file-avatar");

    const view = await run(h);

    expect(view.deletedCount).toBe(1);
    expect(storedIds(h)).toEqual(["file-avatar"]);
  });

  it("TC-storage-055: hands the quota subscriber the owner and size of every row it removed, without touching the quota itself", async () => {
    const h = createTestHarness();
    await seedFile(h, { id: "file-1", purpose: "media", size: 40 });
    await seedFile(h, { id: "file-2", purpose: "source", size: 60 });

    await run(h);

    expect(
      deletionEvents(h).map((payload) => ({
        owner: payload.owner,
        size: payload.size as number,
      })),
    ).toEqual([
      { owner, size: 40 },
      { owner, size: 60 },
    ]);
    // The delta is the subscriber's to apply; this turn writes metadata
    // only, so nothing here has moved the quota row.
    expect(h.backend.scope(scope).storageQuotas.values()).toEqual([]);
  });

  it("TC-storage-056: leaves the objects to the `storage.fileDeleted` subscriber", async () => {
    const h = createTestHarness();
    await seedFile(h, { id: "file-1", purpose: "media" });
    const objectKey = objectKeyOf("file-1", "media");

    await run(h);

    // The metadata is gone but the bytes are still there until the
    // subscriber runs — they cannot share a transaction.
    expect(await h.workerContainer.objectStorage.get(objectKey)).not.toBeNull();
    const payload = deletionEvents(h)[0];
    if (payload === undefined) {
      throw new Error("no deletion event");
    }
    await deleteStoredObjects(
      {
        id: "event-1",
        type: "storage.fileDeleted",
        payload,
        occurredAt: h.clock.now(),
        aggregateId: "user:user-1",
      } as unknown as FileDeletedEvent,
      h.workerContainer,
    );
    expect(await h.workerContainer.objectStorage.get(objectKey)).toBeNull();
  });

  it("TC-storage-057: succeeds with nothing to do for a note that owns no file", async () => {
    const h = createTestHarness();

    const view = await run(h);

    expect(view.deletedCount).toBe(0);
    expect(deletionEvents(h)).toEqual([]);
    expect(tasks(h)).toEqual([]);
  });

  it("TC-storage-058: reclaims 250 rows a page at a time, each turn carrying the same deletion token", async () => {
    const h = createTestHarness();
    for (let n = 0; n < 250; n += 1) {
      await seedFile(h, {
        id: `file-${String(n).padStart(3, "0")}`,
        purpose: "media",
      });
    }
    await openBarrier(h);

    const first = await run(h, DELETION_OPERATION);
    expect(first.deletedCount).toBe(NOTE_FILE_DELETE_BATCH_SIZE);
    expect(
      tasks(h).map((task) => ({
        kind: task.kind,
        operationId: task.operationId,
        priority: task.priority,
        payload: task.payload,
      })),
    ).toEqual([
      {
        kind: NOTE_FILE_DELETE_TASK_KIND,
        operationId: PURGE_OPERATION,
        priority: ScopeTaskPriority.securityCleanup,
        payload: { noteId: NOTE, deletionOperationId: DELETION_OPERATION },
      },
    ]);

    const second = await run(h, DELETION_OPERATION);
    expect(second.deletedCount).toBe(NOTE_FILE_DELETE_BATCH_SIZE);
    // Still exactly one row: the continuation is keyed by
    // `(kind, operationId)`, so re-arming rewrites it.
    expect(tasks(h)).toHaveLength(1);

    const third = await run(h, DELETION_OPERATION);
    expect(third.deletedCount).toBe(50);
    expect(storedIds(h)).toEqual([]);
    // The last turn settles its own row instead of arming another.
    expect(tasks(h)).toEqual([]);
    expect(
      deletionEvents(h).every(
        (payload) => payload.deletionOperationId === DELETION_OPERATION,
      ),
    ).toBe(true);
  });

  it("TC-storage-058: has its continuation resumed by the scope-task runner, so an unregistered kind cannot strand the rest", async () => {
    const h = createTestHarness();
    for (let n = 0; n <= NOTE_FILE_DELETE_BATCH_SIZE; n += 1) {
      await seedFile(h, {
        id: `file-${String(n).padStart(3, "0")}`,
        purpose: "media",
      });
    }

    await run(h);
    expect(tasks(h)).toHaveLength(1);

    const round = await runDueScopeTasks(h.workerContainer);

    expect(round.processed).toBe(1);
    expect(storedIds(h)).toEqual([]);
    expect(tasks(h)).toEqual([]);
    expect(
      h.logger.byLevel("warn").map((entry) => entry.message),
    ).not.toContain(
      `[scope-tasks] no handler for ${NOTE_FILE_DELETE_TASK_KIND}`,
    );
  });

  it("TC-storage-059: proceeds under a personal account deletion that owns the scope", async () => {
    const h = createTestHarness();
    await seedFile(h, { id: "file-1", purpose: "media" });
    await openBarrier(h);

    const view = await run(h, DELETION_OPERATION);

    expect(view.deletedCount).toBe(1);
    expect(deletionEvents(h)[0]?.deletionOperationId).toBe(DELETION_OPERATION);
  });

  it("TC-storage-060: refuses a token that does not own this scope's cleanup, leaving the rows in place", async () => {
    const h = createTestHarness();
    await seedFile(h, { id: "file-1", purpose: "media" });
    await openBarrier(h);

    const error = await run(h, "workspace-deletion-9").then(
      () => null,
      (thrown: unknown) => thrown,
    );

    expect(isConflictError(error)).toBe(true);
    expect(storedIds(h)).toEqual(["file-1"]);
    expect(deletionEvents(h)).toEqual([]);
  });

  it("TC-storage-061: is a no-op on redelivery, since deleted rows do not come back", async () => {
    const h = createTestHarness();
    await seedFile(h, { id: "file-1", purpose: "media" });

    const first = await run(h);
    const second = await run(h);

    expect(first.deletedCount).toBe(1);
    expect(second.deletedCount).toBe(0);
    expect(deletionEvents(h)).toHaveLength(1);
  });

  it("TC-storage-062: skips a row that vanished between the listing and the delete, and reclaims the rest", async () => {
    const h = createTestHarness();
    await seedFile(h, { id: "file-1", purpose: "media" });
    await seedFile(h, { id: "file-2", purpose: "media" });

    const real = h.workerContainer.scopeUnitOfWorkProvider;
    let interfered = false;
    const view = await deleteFilesForNote({
      container: {
        ...h.workerContainer,
        scopeUnitOfWorkProvider: {
          run: (target, fn) =>
            real.run(target, (ctx) =>
              fn({
                ...ctx,
                storedFileRepository: {
                  ...ctx.storedFileRepository,
                  // The window: the page has been read, and one of its
                  // rows is gone by the time the delete reaches it.
                  async findById(id) {
                    if (!interfered) {
                      interfered = true;
                      return null;
                    }
                    return ctx.storedFileRepository.findById(id);
                  },
                },
              }),
            ),
        },
      },
      input: {
        noteId: NOTE,
        scope,
        operationId: PURGE_OPERATION,
        deletionOperationId: null,
      },
    });

    expect(view.deletedCount).toBe(1);
    expect(storedIds(h)).toEqual(["file-1"]);
    expect(deletionEvents(h).map((payload) => payload.fileId)).toEqual([
      "file-2",
    ]);
  });
});
