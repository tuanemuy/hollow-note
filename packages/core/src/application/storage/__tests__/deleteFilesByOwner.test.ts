import { ScopeKey } from "@repo/core/application/scope";
import { Version } from "@repo/core/domain/common/version";
import { UserId } from "@repo/core/domain/identity/valueObject";
import { NoteId } from "@repo/core/domain/note/valueObject";
import type { EphemeralFile } from "@repo/core/domain/storage/storedFile";
import { StoredFile } from "@repo/core/domain/storage/storedFile";
import {
  ByteSize,
  Checksum,
  FileName,
  MimeType,
  ObjectKey,
  StorageOwner,
  StoredFileId,
} from "@repo/core/domain/storage/valueObject";
import { WorkspaceId } from "@repo/core/domain/workspace/valueObject";
import { describe, expect, it } from "vitest";
import { createTestHarness, type TestHarness } from "../../__tests__/helpers";
import { STORAGE_OWNER_DELETE_TASK_KIND } from "../../cleanup/participants";
import type { WorkerContainer } from "../../di/types";
import { deleteFilesByOwner } from "../deleteFilesByOwner";

const USER_ID = "user-1";
const WORKSPACE_ID = "workspace-1";
const OPERATION_ID = "deletion-1";
const userId = UserId.create(USER_ID);
const workspaceId = WorkspaceId.create(WORKSPACE_ID);
const owner = StorageOwner.user(userId);
const workspaceOwner = StorageOwner.workspace(workspaceId);
const scope = ScopeKey.user(userId);
const workspaceScope = ScopeKey.workspace(workspaceId);
const CHECKSUM = Checksum.sha256("c".repeat(64));

const scopeOfOwner = (target: StorageOwner): ScopeKey =>
  target.type === "user"
    ? ScopeKey.user(target.userId)
    : ScopeKey.workspace(target.workspaceId);

const openBarrier = (h: TestHarness, target: ScopeKey = scope) =>
  h.container.scopeUnitOfWorkProvider.run(target, (ctx) =>
    ctx.cleanupAdmission.beginPersonalAccountDeletion(OPERATION_ID, userId),
  );

async function seedFiles(
  h: TestHarness,
  params: Readonly<{
    count: number;
    purpose?: "avatar" | "media" | "source";
    target?: StorageOwner;
    prefix?: string;
  }>,
): Promise<void> {
  const fileOwner = params.target ?? owner;
  const purpose = params.purpose ?? "media";
  const prefix = params.prefix ?? "file";
  await h.container.scopeUnitOfWorkProvider.run(
    scopeOfOwner(fileOwner),
    async (ctx) => {
      for (let i = 0; i < params.count; i += 1) {
        const id = `${prefix}-${String(i).padStart(3, "0")}`;
        const fileId = StoredFileId.create(id);
        const registered = StoredFile.register(
          {
            id,
            owner: fileOwner,
            objectKey: ObjectKey.build(fileOwner, purpose, fileId, "png"),
            fileName: `${id}.png`,
            mimeType: "image/png",
            size: 10,
            checksum: CHECKSUM,
            ...(purpose === "avatar"
              ? ({ purpose, noteId: null, uploadedBy: userId } as const)
              : ({
                  purpose,
                  noteId: NoteId.create(`note-of-${id}`),
                  uploadedBy: userId,
                } as const)),
          },
          h.clock.now(),
        );
        await ctx.storedFileRepository.insert(registered.entity);
      }
    },
  );
}

/** Artifacts only exist as ephemeral rows the conversion slice will write. */
async function seedArtifact(h: TestHarness, id: string): Promise<void> {
  const fileId = StoredFileId.create(id);
  const now = h.clock.now();
  const file: EphemeralFile = {
    id: fileId,
    owner,
    objectKey: ObjectKey.build(owner, "artifact", fileId, "pdf"),
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
    noteId: null,
    noteVersion: null,
    uploadedBy: userId,
  };
  await h.container.scopeUnitOfWorkProvider.run(scope, (ctx) =>
    ctx.storedFileRepository.insert(file),
  );
}

const run = (
  h: TestHarness,
  overrides: Partial<{
    scope: ScopeKey;
    batchSize: number;
    commandKey: string;
    container: WorkerContainer;
  }> = {},
) =>
  deleteFilesByOwner({
    container: overrides.container ?? h.workerContainer,
    input: {
      deletionOperationId: OPERATION_ID,
      scope: overrides.scope ?? scope,
      ...(overrides.batchSize !== undefined
        ? { batchSize: overrides.batchSize }
        : {}),
      ...(overrides.commandKey !== undefined
        ? { commandKey: overrides.commandKey }
        : {}),
    },
  });

/** Container whose file reads succeed but whose OCC reads find nothing. */
const withVanishingFiles = (
  h: TestHarness,
  vanishes: (id: string) => boolean,
): WorkerContainer => ({
  ...h.workerContainer,
  scopeUnitOfWorkProvider: {
    run: (target, fn) =>
      h.workerContainer.scopeUnitOfWorkProvider.run(target, (ctx) =>
        fn({
          ...ctx,
          storedFileRepository: {
            ...ctx.storedFileRepository,
            findById: async (id) =>
              vanishes(id) ? null : ctx.storedFileRepository.findById(id),
          },
        }),
      ),
  },
});

const filesOf = (h: TestHarness, target: ScopeKey = scope) =>
  h.backend.scope(target).storedFiles.values();

const deletionEvents = (h: TestHarness) =>
  h.backend.outbox.values().filter((row) => row.type === "storage.fileDeleted");

const tasks = (h: TestHarness) =>
  h.backend
    .scope(scope)
    .scheduledTasks.values()
    .filter((task) => task.kind === STORAGE_OWNER_DELETE_TASK_KIND);

const acknowledged = (h: TestHarness, target: ScopeKey = scope) =>
  h.backend.scope(target).cleanupReceipts.values()[0]?.acknowledged ?? [];

describe("deleteFilesByOwner", () => {
  it("TC-storage-037: 120 files with batchSize 50 delete a page and arm exactly one continuation", async () => {
    const h = createTestHarness();
    await openBarrier(h);
    await seedFiles(h, { count: 120 });

    const turn = await run(h, { batchSize: 50 });

    expect(turn).toMatchObject({ status: "continued", deletedCount: 50 });
    expect(filesOf(h)).toHaveLength(70);
    expect(tasks(h)).toHaveLength(1);
  });

  it("TC-storage-038: exactly batchSize targets are all deleted without a continuation", async () => {
    const h = createTestHarness();
    await openBarrier(h);
    await seedFiles(h, { count: 100 });

    const turn = await run(h);

    expect(turn).toMatchObject({ status: "settled", deletedCount: 100 });
    expect(filesOf(h)).toHaveLength(0);
    expect(tasks(h)).toHaveLength(0);
    expect(acknowledged(h)).toContain("storage");
  });

  it("TC-storage-039: the continuation is a single scope task carrying the deletion operation", async () => {
    const h = createTestHarness();
    await openBarrier(h);
    await seedFiles(h, { count: 30 });

    await run(h, { batchSize: 10 });

    expect(tasks(h)).toHaveLength(1);
    expect(tasks(h)[0]).toMatchObject({
      kind: STORAGE_OWNER_DELETE_TASK_KIND,
      operationId: OPERATION_ID,
      payload: { deletionOperationId: OPERATION_ID },
    });
  });

  it("TC-storage-040: a continuation turn reads the remaining files from the start, carrying no cursor", async () => {
    const h = createTestHarness();
    await openBarrier(h);
    await seedFiles(h, { count: 30 });

    await run(h, { batchSize: 10 });
    await run(h, { batchSize: 10 });
    const last = await run(h, { batchSize: 10 });

    expect(last).toMatchObject({ status: "settled", deletedCount: 10 });
    expect(filesOf(h)).toHaveLength(0);
    expect(tasks(h)).toHaveLength(0);
  });

  it("TC-storage-041: a batch that deletes nothing while targets remain backs off instead of continuing", async () => {
    const h = createTestHarness();
    await openBarrier(h);
    await seedFiles(h, { count: 5 });
    await h.container.scopeUnitOfWorkProvider.run(scope, (ctx) =>
      ctx.scopeTaskScheduler.schedule({
        kind: STORAGE_OWNER_DELETE_TASK_KIND,
        operationId: OPERATION_ID,
        dueAt: h.clock.now(),
        payload: { deletionOperationId: OPERATION_ID },
      }),
    );

    const turn = await run(h, {
      container: withVanishingFiles(h, () => true),
    });

    expect(turn).toMatchObject({ status: "stalled", deletedCount: 0 });
    expect(tasks(h)[0]?.attempt).toBe(1);
    expect(acknowledged(h)).not.toContain("storage");
  });

  it("TC-storage-042: two continuation chains on the same owner converge", async () => {
    const h = createTestHarness();
    await openBarrier(h);
    await seedFiles(h, { count: 15 });

    const [first, second] = [
      await run(h, { batchSize: 10 }),
      await run(h, { batchSize: 10 }),
    ];
    const third = await run(h, { batchSize: 10 });

    expect(first.deletedCount + second.deletedCount).toBe(15);
    expect(third).toMatchObject({ status: "settled", deletedCount: 0 });
    expect(deletionEvents(h)).toHaveLength(15);
  });

  it("TC-storage-043: one turn enumerates once and emits one event per file, whatever the count", async () => {
    const h = createTestHarness();
    await openBarrier(h);
    await seedFiles(h, { count: 40 });
    let enumerations = 0;
    const counting: WorkerContainer = {
      ...h.workerContainer,
      scopeUnitOfWorkProvider: {
        run: (target, fn) =>
          h.workerContainer.scopeUnitOfWorkProvider.run(target, (ctx) =>
            fn({
              ...ctx,
              storedFileRepository: {
                ...ctx.storedFileRepository,
                listByOwner: async (...args) => {
                  enumerations += 1;
                  return ctx.storedFileRepository.listByOwner(...args);
                },
              },
            }),
          ),
      },
    };

    await run(h, { container: counting });

    // The per-row `findById` the OCC contract requires is a property of
    // this adapter, not of the turn: what the turn promises is a single
    // enumeration and one deletion event per file (ADR-022).
    expect(enumerations).toBe(1);
    expect(deletionEvents(h)).toHaveLength(40);
  });

  it("TC-storage-045: a workspace subject loses only that workspace's files", async () => {
    const h = createTestHarness();
    await openBarrier(h, workspaceScope);
    await seedFiles(h, { count: 3 });
    await seedFiles(h, { count: 2, target: workspaceOwner, prefix: "ws" });

    const turn = await run(h, { scope: workspaceScope });

    expect(turn).toMatchObject({ status: "settled", deletedCount: 2 });
    expect(filesOf(h, workspaceScope)).toHaveLength(0);
    expect(filesOf(h)).toHaveLength(3);
  });

  it("TC-storage-046: an owner with no files settles with deletedCount 0", async () => {
    const h = createTestHarness();
    await openBarrier(h);

    const turn = await run(h);

    expect(turn).toMatchObject({ status: "settled", deletedCount: 0 });
    expect(acknowledged(h)).toContain("storage");
  });

  it("TC-storage-047: a single failing deletion is skipped and the rest of the batch continues", async () => {
    const h = createTestHarness();
    await openBarrier(h);
    await seedFiles(h, { count: 5 });

    const turn = await run(h, {
      container: withVanishingFiles(h, (id) => id === "file-002"),
    });

    expect(turn.deletedCount).toBe(4);
    expect(filesOf(h)).toHaveLength(1);
    expect(deletionEvents(h)).toHaveLength(4);
  });

  it("TC-storage-048: running the same request twice leaves the same result", async () => {
    const h = createTestHarness();
    await openBarrier(h);
    await seedFiles(h, { count: 4 });

    const first = await run(h);
    const second = await run(h);

    expect(first).toMatchObject({ status: "settled", deletedCount: 4 });
    expect(second).toMatchObject({ status: "settled", deletedCount: 0 });
    expect(deletionEvents(h)).toHaveLength(4);
  });

  it("TC-storage-049: icons and artifacts go too, whatever their purpose", async () => {
    const h = createTestHarness();
    await openBarrier(h);
    await seedFiles(h, { count: 1, purpose: "avatar", prefix: "avatar" });
    await seedFiles(h, { count: 1, purpose: "source", prefix: "source" });
    await seedArtifact(h, "artifact-000");

    const turn = await run(h);

    expect(turn.deletedCount).toBe(3);
    expect(filesOf(h)).toHaveLength(0);
  });

  it("TC-storage-050: every deleted file emits its own storage.fileDeleted carrying the object key", async () => {
    const h = createTestHarness();
    await openBarrier(h);
    await seedFiles(h, { count: 3 });

    await run(h);

    const events = deletionEvents(h);
    expect(events).toHaveLength(3);
    for (const event of events) {
      expect(event.payload).toMatchObject({
        deletionOperationId: OPERATION_ID,
      });
      expect(event.payload).toHaveProperty("objectKey");
    }
  });

  it("suppresses a redelivered initial command through the applied-operation record", async () => {
    const h = createTestHarness();
    await openBarrier(h);
    await seedFiles(h, { count: 2 });

    const first = await run(h, {
      commandKey: `${OPERATION_ID}:cleanup:storage`,
    });
    const second = await run(h, {
      commandKey: `${OPERATION_ID}:cleanup:storage`,
    });

    expect(first.status).toBe("settled");
    expect(second.status).toBe("alreadyApplied");
  });
});
