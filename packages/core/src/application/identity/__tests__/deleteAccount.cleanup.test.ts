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
import { PERSONAL_BARRIER_PRUNE_TASK_KIND } from "../../cleanup/personalCleanup";
import { storeAvatar } from "../../storage/storeAvatar";
import {
  type EventDispatchOutcome,
  processOutboxEvents,
} from "../../workers/eventRelayWorker";
import { dispatchDomainEvent } from "../../workers/subscribers";
import { deleteAccount } from "../deleteAccount";
import { dispatchAccountDeletionCleanup } from "../deleteAccount/cleanupDispatch";
import { continueAccountDeletionManifestBuild } from "../deleteAccount/manifestBuild";
import { signUpVerified } from "./authFlowHelpers";

const EMAIL = "user@example.com";
const REQUEST_ID = "11111111-1111-4111-8111-111111111111";
const DAY_MS = 24 * 60 * 60 * 1000;
const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

type Accepted = Readonly<{ userId: string; operationId: string }>;

const scopeOf = (userId: string) => ScopeKey.user(UserId.create(userId));

async function acceptAndBuild(h: TestHarness): Promise<Accepted> {
  const { userId } = await signUpVerified(h, EMAIL);
  const view = await deleteAccount({
    container: h.container,
    input: {
      type: "userRequest",
      userId,
      confirmationEmail: EMAIL,
      requestId: REQUEST_ID,
    },
  });
  for (const phase of ["memberships", "authorRoutes"] as const) {
    await continueAccountDeletionManifestBuild(h.workerContainer, {
      type: "identity.accountDeletionManifestBuildContinued",
      operationId: view.operationId,
      phase,
      cursor: null,
    });
  }
  return { userId, operationId: view.operationId };
}

const dispatch = (h: TestHarness, operationId: string) =>
  dispatchAccountDeletionCleanup(h.workerContainer, {
    type: "identity.accountDeletionDispatchContinued",
    operationId,
    phase: "cleanup",
    cursor: null,
  });

const receipt = (h: TestHarness, userId: string) =>
  h.backend.scope(scopeOf(userId)).cleanupReceipts.values()[0];

const manifestReceipts = (h: TestHarness, operationId: string) =>
  h.backend.manifestHeaders.get(operationId)?.receipts ?? [];

const pruneTasks = (h: TestHarness, userId: string) =>
  h.backend
    .scope(scopeOf(userId))
    .scheduledTasks.values()
    .filter((task) => task.kind === PERSONAL_BARRIER_PRUNE_TASK_KIND);

/**
 * Files inserted straight into the scope: `storeAvatar` replaces the
 * icon it supersedes, so it cannot stage a backlog bigger than one
 * cleanup turn.
 */
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

describe("deleteAccount personal cleanup", () => {
  it("TC-identity-084: every declared component acked completes the barrier, and only then is the receipt recorded", async () => {
    const h = createTestHarness();
    const { userId, operationId } = await acceptAndBuild(h);

    await dispatch(h, operationId);

    const barrier = receipt(h, userId);
    expect(barrier?.status).toBe("completed");
    expect(barrier?.acknowledged).toEqual(
      expect.arrayContaining(["storage", "usage"]),
    );
    expect(barrier?.retainUntil?.getTime()).toBe(
      h.clock.now().getTime() + 120 * DAY_MS,
    );
    expect(pruneTasks(h, userId)).toHaveLength(1);
    expect(pruneTasks(h, userId)[0]?.dueAt).toEqual(barrier?.retainUntil);
    expect(manifestReceipts(h, operationId)).toContain("personalCleanup");
  });

  it("TC-identity-085: one declared component short leaves the barrier running", async () => {
    const h = createTestHarness();
    const { userId } = await signUpVerified(h, EMAIL);
    // More files than a single storage turn removes, so `storage` cannot
    // acknowledge in the wave that `usage` finishes in.
    await seedFiles(h, userId, 150);
    const view = await deleteAccount({
      container: h.container,
      input: {
        type: "userRequest",
        userId,
        confirmationEmail: EMAIL,
        requestId: REQUEST_ID,
      },
    });
    for (const phase of ["memberships", "authorRoutes"] as const) {
      await continueAccountDeletionManifestBuild(h.workerContainer, {
        type: "identity.accountDeletionManifestBuildContinued",
        operationId: view.operationId,
        phase,
        cursor: null,
      });
    }

    await dispatch(h, view.operationId);

    const barrier = receipt(h, userId);
    expect(barrier?.status).toBe("running");
    expect(barrier?.acknowledged).toContain("usage");
    expect(barrier?.acknowledged).not.toContain("storage");
    expect(manifestReceipts(h, view.operationId)).not.toContain(
      "personalCleanup",
    );
  });

  it("TC-identity-086: the final page stores its ack and leaves no continuation behind", async () => {
    const h = createTestHarness();
    const { userId, operationId } = await acceptAndBuild(h);

    await dispatch(h, operationId);

    const tasks = h.backend.scope(scopeOf(userId)).scheduledTasks.values();
    // Only the barrier's own expiry survives the wave.
    expect(tasks.map((task) => task.kind)).toEqual([
      PERSONAL_BARRIER_PRUNE_TASK_KIND,
    ]);
    expect(receipt(h, userId)?.acknowledged).toHaveLength(2);
  });

  it("TC-identity-087: a lost response after the barrier commit only re-records the receipt", async () => {
    const h = createTestHarness();
    const { userId, operationId } = await acceptAndBuild(h);

    await dispatch(h, operationId);
    // The manifest never learned about the completion, so the wave is
    // re-driven against an already completed barrier.
    await h.container.globalUnitOfWorkProvider.run(async (ctx) => {
      const header = h.backend.manifestHeaders.get(operationId);
      if (header === undefined) {
        throw new Error("missing manifest header");
      }
      h.backend.manifestHeaders.set(operationId, { ...header, receipts: [] });
      await ctx.accountDeletionManifestStore.describe(operationId);
    });

    await dispatch(h, operationId);

    expect(receipt(h, userId)?.status).toBe("completed");
    expect(manifestReceipts(h, operationId)).toEqual(["personalCleanup"]);
  });

  it("TC-identity-089: a redelivered cleanup command is not applied twice and the turn resumes from its own task", async () => {
    const h = createTestHarness();
    const { userId, operationId } = await acceptAndBuild(h);
    await seedFiles(h, userId, 150);

    await dispatch(h, operationId);
    expect(h.backend.scope(scopeOf(userId)).storedFiles.values()).toHaveLength(
      50,
    );

    // The same command arrives again; the scope has it on record, so the
    // rest of the work stays with the continuation it already armed.
    await dispatch(h, operationId);

    expect(
      h.backend.scope(scopeOf(userId)).appliedOperations.values(),
    ).toHaveLength(2);
    expect(h.backend.scope(scopeOf(userId)).storedFiles.values()).toHaveLength(
      50,
    );
    expect(manifestReceipts(h, operationId)).not.toContain("personalCleanup");
  });

  it("TC-identity-044: a file write that committed before the barrier is collected by the owner scan", async () => {
    const h = createTestHarness();
    const { userId } = await signUpVerified(h, EMAIL);
    const stored = await storeAvatar({
      container: h.container,
      input: {
        userId,
        subjectType: "user",
        subjectId: userId,
        fileName: "icon.png",
        declaredMimeType: "image/png",
        body: PNG,
      },
    });
    expect(
      h.backend.scope(scopeOf(userId)).storedFiles.get(stored.fileId),
    ).toBeDefined();

    const view = await deleteAccount({
      container: h.container,
      input: {
        type: "userRequest",
        userId,
        confirmationEmail: EMAIL,
        requestId: REQUEST_ID,
      },
    });
    for (const phase of ["memberships", "authorRoutes"] as const) {
      await continueAccountDeletionManifestBuild(h.workerContainer, {
        type: "identity.accountDeletionManifestBuildContinued",
        operationId: view.operationId,
        phase,
        cursor: null,
      });
    }
    await dispatch(h, view.operationId);

    expect(h.backend.scope(scopeOf(userId)).storedFiles.values()).toHaveLength(
      0,
    );
  });

  it("TC-identity-046: a running barrier has no expiry and survives a prune pass", async () => {
    const h = createTestHarness();
    const { userId, operationId } = await acceptAndBuild(h);
    await seedFiles(h, userId, 150);

    await dispatch(h, operationId);
    h.clock.advance(365 * DAY_MS);

    const reclaimed = await h.container.scopeUnitOfWorkProvider.run(
      scopeOf(userId),
      async (ctx) => {
        const removed = await ctx.cleanupAdmission.pruneCompleted(
          h.clock.now(),
          100,
        );
        // Ownership checks keep working for as long as it runs.
        await ctx.cleanupAdmission.assertOwner(operationId);
        return removed;
      },
    );

    expect(reclaimed).toBe(0);
    expect(receipt(h, userId)?.status).toBe("running");
    expect(receipt(h, userId)?.retainUntil).toBeNull();
  });

  it("drives itself from the relay: accepting is enough to run the deletion out", async () => {
    const h = createTestHarness();
    const { userId } = await signUpVerified(h, EMAIL);
    await seedFiles(h, userId, 3);
    const view = await deleteAccount({
      container: h.container,
      input: {
        type: "userRequest",
        userId,
        confirmationEmail: EMAIL,
        requestId: REQUEST_ID,
      },
    });

    await processOutboxEvents(h.workerContainer, async (events) => {
      const outcomes: EventDispatchOutcome[] = [];
      for (const event of events) {
        await dispatchDomainEvent(event, h.workerContainer);
        outcomes.push({ kind: "success", id: event.id });
      }
      return outcomes;
    });

    expect(h.backend.manifestHeaders.get(view.operationId)?.status).toBe(
      "completed",
    );
    expect(receipt(h, userId)?.status).toBe("completed");
    expect(manifestReceipts(h, view.operationId)).toContain("personalCleanup");
    expect(h.backend.scope(scopeOf(userId)).storedFiles.values()).toHaveLength(
      0,
    );
  });

  it("TC-identity-047: a completed barrier keeps its receipt for 120 days, no-ops duplicates and is then reclaimed", async () => {
    const h = createTestHarness();
    const { userId, operationId } = await acceptAndBuild(h);
    await dispatch(h, operationId);
    const retainUntil = receipt(h, userId)?.retainUntil;
    if (retainUntil === null || retainUntil === undefined) {
      throw new Error("a completed barrier carries a retention deadline");
    }

    const reclaimed = await h.container.scopeUnitOfWorkProvider.run(
      scopeOf(userId),
      async (ctx) => {
        // A duplicate ack inside the window is a safe no-op.
        await ctx.cleanupAdmission.acknowledgePersonalComponent(
          operationId,
          "storage",
        );
        expect(
          await ctx.cleanupAdmission.pruneCompleted(
            new Date(retainUntil.getTime() - 1),
            100,
          ),
        ).toBe(0);
        return ctx.cleanupAdmission.pruneCompleted(retainUntil, 100);
      },
    );

    expect(reclaimed).toBe(1);
    expect(receipt(h, userId)).toBeUndefined();
  });
});
