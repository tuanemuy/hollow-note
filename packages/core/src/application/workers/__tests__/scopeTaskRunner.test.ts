import { createMemoryGlobalUnitOfWorkProvider } from "@repo/core/adapters/memory/globalUnitOfWork";
import { createMemoryScopeTaskQueue } from "@repo/core/adapters/memory/scopeTaskQueue";
import { createMemoryScopeUnitOfWorkProvider } from "@repo/core/adapters/memory/scopeUnitOfWork";
import {
  SCOPE_TASK_MAX_ATTEMPTS,
  SCOPE_TASK_MAX_BACKOFF_MS,
} from "@repo/core/application/ports/scopeTaskScheduler";
import { ScopeKey } from "@repo/core/application/scope";
import { UserId } from "@repo/core/domain/identity/valueObject";
import { NoteId } from "@repo/core/domain/note/valueObject";
import { StoredFile } from "@repo/core/domain/storage/storedFile";
import {
  Checksum,
  ObjectKey,
  StorageOwner,
  StoredFileId,
} from "@repo/core/domain/storage/valueObject";
import { describe, expect, it } from "vitest";
import { createTestHarness, type TestHarness } from "../../__tests__/helpers";
import {
  REQUIRED_FINALIZE_RECEIPTS,
  REQUIRED_PERSONAL_CLEANUP_COMPONENTS,
  STORAGE_OWNER_DELETE_TASK_KIND,
} from "../../cleanup/participants";
import type { WorkerContainer } from "../../di/types";
import { signUpVerified } from "../../identity/__tests__/authFlowHelpers";
import {
  acceptDeletion,
  drainDeletion,
} from "../../identity/__tests__/deletionHarness";
import { runDueScopeTasks } from "../scopeTaskRunner";

const EMAIL = "user@example.com";

const scopeOf = (userId: string) => ScopeKey.user(UserId.create(userId));

const seedFiles = (h: TestHarness, userId: string, count: number) => {
  const owner = StorageOwner.user(UserId.create(userId));
  return h.container.scopeUnitOfWorkProvider.run(
    scopeOf(userId),
    async (ctx) => {
      for (let i = 0; i < count; i += 1) {
        const id = `seed-file-${String(i).padStart(3, "0")}`;
        const fileId = StoredFileId.create(id);
        const registered = StoredFile.register(
          {
            id,
            owner,
            objectKey: ObjectKey.build(owner, "media", fileId, "png"),
            fileName: `${id}.png`,
            mimeType: "image/png",
            size: 10,
            checksum: Checksum.sha256("d".repeat(64)),
            purpose: "media",
            noteId: NoteId.create(`note-of-${id}`),
            uploadedBy: UserId.create(userId),
          },
          h.clock.now(),
        );
        await ctx.storedFileRepository.insert(registered.entity);
      }
    },
  );
};

const storedFileCount = (h: TestHarness, userId: string): number =>
  h.backend.scope(scopeOf(userId)).storedFiles.values().length;

const receipts = (h: TestHarness, operationId: string) =>
  h.backend.manifestHeaders.get(operationId)?.receipts ?? [];

// Models a process restart: the store outlives it, every container over
// it is built anew.
const restartWorkers = (h: TestHarness): WorkerContainer => {
  const unitOfWorkOptions = {
    requiredCleanupComponents: REQUIRED_PERSONAL_CLEANUP_COMPONENTS,
    requiredFinalizeReceipts: REQUIRED_FINALIZE_RECEIPTS,
  };
  return {
    ...h.workerContainer,
    globalUnitOfWorkProvider: createMemoryGlobalUnitOfWorkProvider(
      h.backend,
      unitOfWorkOptions,
    ),
    scopeUnitOfWorkProvider: createMemoryScopeUnitOfWorkProvider(
      h.backend,
      unitOfWorkOptions,
    ),
    scopeTaskQueue: createMemoryScopeTaskQueue(h.backend),
  };
};

describe("runDueScopeTasks", () => {
  it("resumes a cleanup that outgrew its first turn and hands the completion to the manifest", async () => {
    const h = createTestHarness();
    const { userId } = await signUpVerified(h, EMAIL);
    await seedFiles(h, userId, 150);
    const operationId = await acceptDeletion(h, { userId, email: EMAIL });

    await drainDeletion(h);
    expect(storedFileCount(h, userId)).toBe(50);
    expect(receipts(h, operationId)).not.toContain("personalCleanup");

    const round = await runDueScopeTasks(h.workerContainer);

    expect(round.processed).toBe(1);
    expect(storedFileCount(h, userId)).toBe(0);
    expect(receipts(h, operationId)).toContain("personalCleanup");
  });

  it("carries a deletion to completion across alternating relay and task rounds", async () => {
    const h = createTestHarness();
    const { userId } = await signUpVerified(h, EMAIL);
    await seedFiles(h, userId, 250);
    const operationId = await acceptDeletion(h, { userId, email: EMAIL });

    for (let round = 0; round < 10; round += 1) {
      await drainDeletion(h);
      await runDueScopeTasks(h.workerContainer);
    }

    expect(storedFileCount(h, userId)).toBe(0);
    expect(h.backend.users.get(userId)?.status).toBe("deleted");
    expect(h.backend.manifestHeaders.get(operationId)?.status).toBe(
      "completed",
    );
  });

  it("reads the due rows from the table, so a restarted process resumes them", async () => {
    const h = createTestHarness();
    const { userId } = await signUpVerified(h, EMAIL);
    await seedFiles(h, userId, 150);
    await acceptDeletion(h, { userId, email: EMAIL });
    await drainDeletion(h);

    const due = await h.workerContainer.scopeTaskQueue.listDue(
      h.clock.now(),
      10,
    );
    expect(due.map((task) => task.kind)).toEqual([
      STORAGE_OWNER_DELETE_TASK_KIND,
    ]);
    expect(due.map((task) => ScopeKey.serialize(task.scope))).toEqual([
      ScopeKey.serialize(scopeOf(userId)),
    ]);

    // The "restart": the same store, reached through containers rebuilt
    // from scratch, so nothing the first ones held in process carries the
    // continuation over.
    expect(await runDueScopeTasks(restartWorkers(h))).toEqual({ processed: 1 });
    expect(storedFileCount(h, userId)).toBe(0);
  });

  it("leaves a task whose kind has no handler due, and reports it", async () => {
    const h = createTestHarness();
    const scope = scopeOf("user-1");
    await h.container.scopeUnitOfWorkProvider.run(scope, (ctx) =>
      ctx.scopeTaskScheduler.schedule({
        kind: "unknown.kind",
        operationId: "op-1",
        dueAt: h.clock.now(),
        payload: {},
      }),
    );

    expect(await runDueScopeTasks(h.workerContainer)).toEqual({ processed: 0 });
    expect(
      h.logger.entries.some((entry) =>
        entry.message.includes("no handler for unknown.kind"),
      ),
    ).toBe(true);
    expect(
      await h.workerContainer.scopeTaskQueue.listDue(h.clock.now(), 10),
    ).toHaveLength(1);
  });

  it("isolates a failing task from the rest of the round", async () => {
    const h = createTestHarness();
    const scope = scopeOf("user-1");
    for (const kind of ["failing", "working"]) {
      await h.container.scopeUnitOfWorkProvider.run(scope, (ctx) =>
        ctx.scopeTaskScheduler.schedule({
          kind,
          operationId: `op-${kind}`,
          dueAt: h.clock.now(),
          payload: {},
        }),
      );
    }
    const ran: string[] = [];

    const round = await runDueScopeTasks(h.workerContainer, {
      handlers: {
        failing: async () => {
          throw new Error("boom");
        },
        working: async (_container, task) => {
          ran.push(task.operationId);
        },
      },
    });

    expect(round).toEqual({ processed: 1 });
    expect(ran).toEqual(["op-working"]);
    expect(
      h.logger.entries.some((entry) =>
        entry.message.includes("[scope-tasks] task threw"),
      ),
    ).toBe(true);
  });

  it("backs a throwing task off, so a permanently failing one stops being re-driven", async () => {
    const h = createTestHarness();
    const scope = scopeOf("user-1");
    await h.container.scopeUnitOfWorkProvider.run(scope, (ctx) =>
      ctx.scopeTaskScheduler.schedule({
        kind: "failing",
        operationId: "op-1",
        dueAt: h.clock.now(),
        payload: {},
      }),
    );
    let attempts = 0;
    const handlers = {
      failing: async () => {
        attempts += 1;
        throw new Error("boom");
      },
    };

    await runDueScopeTasks(h.workerContainer, { handlers });
    expect(attempts).toBe(1);
    expect(
      await h.workerContainer.scopeTaskQueue.listDue(h.clock.now(), 10),
    ).toEqual([]);

    for (let round = 0; round < SCOPE_TASK_MAX_ATTEMPTS; round += 1) {
      h.clock.advance(SCOPE_TASK_MAX_BACKOFF_MS);
      await runDueScopeTasks(h.workerContainer, { handlers });
    }

    expect(attempts).toBe(SCOPE_TASK_MAX_ATTEMPTS);
    h.clock.advance(SCOPE_TASK_MAX_BACKOFF_MS);
    expect(
      await h.workerContainer.scopeTaskQueue.listDue(h.clock.now(), 10),
    ).toEqual([]);
  });
});
