import { readNotePurgeTurn } from "@repo/core/application/cleanup/notePurgeFanOut";
import { REQUIRED_PERSONAL_CLEANUP_COMPONENTS } from "@repo/core/application/cleanup/participants";
import { PERSONAL_BARRIER_PRUNE_TASK_KIND } from "@repo/core/application/cleanup/personalCleanup";
import { SystemError, SystemErrorCode } from "@repo/core/application/errors";
import type { ScopeUnitOfWorkProvider } from "@repo/core/application/execution/unitOfWork";
import type { ScopeTaskPayload } from "@repo/core/application/ports/scopeTaskScheduler";
import { ScopeTaskPriority } from "@repo/core/application/ports/scopeTaskScheduler";
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
import { WorkspaceId } from "@repo/core/domain/workspace/valueObject";
import { describe, expect, it } from "vitest";
import { createTestHarness, type TestHarness } from "../../__tests__/helpers";
import { signUpVerified } from "../../identity/__tests__/authFlowHelpers";
import type { AccountDeletionDispatchContinuedEvent } from "../../identity/continuations";
import { IdentityContinuations } from "../../identity/continuations";
import { deleteAccount } from "../../identity/deleteAccount";
import { continueAccountDeletionManifestBuild } from "../../identity/deleteAccount/manifestBuild";
import { runDueScopeTasks } from "../scopeTaskRunner";
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

  it("runs the siblings of a failing subscriber and still fails the delivery", async () => {
    const h = createTestHarness();
    const calls: string[] = [];
    const registry: readonly EventSubscriber[] = [
      {
        eventType: "identity.user.deleted",
        consumerName: "boom",
        handle: async () => {
          calls.push("boom");
          throw new Error("boom");
        },
      },
      {
        eventType: "identity.user.deleted",
        consumerName: "later",
        handle: async () => {
          calls.push("later");
        },
      },
      {
        eventType: "identity.user.deleted",
        consumerName: "boom-2",
        handle: async () => {
          calls.push("boom-2");
          throw new Error("boom-2");
        },
      },
    ];

    // The followers of one event clean up aggregates that know nothing
    // of each other: letting the first failure skip the rest would
    // strand their rows behind an unrelated fault until the outbox row
    // quarantined.
    await expect(
      dispatchDomainEvent(userDeleted(), h.workerContainer, registry),
    ).rejects.toThrow("boom");
    expect(calls).toEqual(["boom", "later", "boom-2"]);
    expect(h.logger.byLevel("error").map((entry) => entry.message)).toEqual([
      "[subscribers] boom failed for identity.user.deleted",
      "[subscribers] boom-2 failed for identity.user.deleted",
    ]);
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

/**
 * A note of one owner, with the residue the three followers reclaim.
 * The owner is what the subscribers turn into a scope, so the two
 * targets below are the two branches of `scopeOfNoteOwner`.
 */
type PurgeTarget = Readonly<{
  scope: ScopeKey;
  noteOwner: NoteOwner;
  storageOwner: StorageOwner;
  suffix: string;
}>;

const PERSONAL_TARGET: PurgeTarget = {
  scope: ScopeKey.user(UserId.create("user-1")),
  noteOwner: NoteOwner.user(UserId.create("user-1")),
  storageOwner: StorageOwner.user(UserId.create("user-1")),
  suffix: "personal",
};

const WORKSPACE_TARGET: PurgeTarget = {
  scope: ScopeKey.workspace(WorkspaceId.create("workspace-1")),
  noteOwner: NoteOwner.workspace(WorkspaceId.create("workspace-1")),
  storageOwner: StorageOwner.workspace(WorkspaceId.create("workspace-1")),
  suffix: "workspace",
};

const notePurged = (
  target: PurgeTarget = PERSONAL_TARGET,
): NotePurgedEvent => ({
  id: EventId.create("event-3"),
  type: "note.purged",
  payload: {
    noteId: PURGED_NOTE,
    owner: target.noteOwner,
    sourceFileId: StoredFileId.create(`file-${target.suffix}`),
    operationId: "purge-note-1",
    deletionOperationId: null,
    routeVersion: 1,
    projectionRevision: 1,
  },
  occurredAt: new Date("2026-01-01T00:00:00.000Z"),
  aggregateId: "note-1",
});

async function seedPurgeResidue(
  h: TestHarness,
  target: PurgeTarget = PERSONAL_TARGET,
): Promise<void> {
  const fileId = StoredFileId.create(`file-${target.suffix}`);
  await h.container.scopeUnitOfWorkProvider.run(target.scope, async (ctx) => {
    await ctx.storedFileRepository.insert(
      StoredFile.register(
        {
          id: fileId,
          owner: target.storageOwner,
          objectKey: ObjectKey.build(
            target.storageOwner,
            "source",
            fileId,
            "html",
          ),
          fileName: `${fileId}.html`,
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
        id: `assignment-${target.suffix}`,
        tagId: "tag-1",
        noteId: PURGED_NOTE,
        scopeType: target.scope.type,
        scopeId:
          target.scope.type === "user"
            ? target.scope.userId
            : target.scope.workspaceId,
        assignedBy: "user-1",
        assignedAt: h.clock.now(),
      }),
    );
    await ctx.backupRecordRepository.insert(
      BackupRecord.reconstruct({
        id: `backup-${target.suffix}`,
        userId: "user-1",
        noteId: PURGED_NOTE,
        sourceFileId: fileId,
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

const residueCounts = (
  h: TestHarness,
  target: PurgeTarget = PERSONAL_TARGET,
) => {
  const store = h.backend.scope(target.scope);
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

  // The event carries an owner, not a scope, so the subscribers are the
  // only place the workspace branch of `scopeOfNoteOwner` is exercised —
  // the usecase tests hand `scope` in by hand. Seeding both scopes is
  // what makes the assertion about *which* scope was reached rather than
  // about deletion happening somewhere.
  it("TC-integration-022: reclaims a workspace-owned note's residue in the workspace scope, leaving the personal scope untouched", async () => {
    const h = createTestHarness();
    await seedPurgeResidue(h, PERSONAL_TARGET);
    await seedPurgeResidue(h, WORKSPACE_TARGET);

    await dispatchDomainEvent(notePurged(WORKSPACE_TARGET), h.workerContainer);

    expect(residueCounts(h, WORKSPACE_TARGET)).toEqual({
      files: 0,
      assignments: 0,
      backups: 0,
    });
    expect(residueCounts(h, PERSONAL_TARGET)).toEqual({
      files: 1,
      assignments: 1,
      backups: 1,
    });
    expect(h.logger.byLevel("warn")).toHaveLength(0);
  });
});

describe("readNotePurgeTurn", () => {
  // Unlike the orphan-media sweep's reader, which restarts from the head
  // on an unreadable position (TC-storage-255), this payload *is* the
  // work: a turn that cannot name its note has nothing to fall back on,
  // so it faults instead of guessing.
  it("faults on a payload that names no note or an unreadable token, rather than inventing a turn", () => {
    expect(() => readNotePurgeTurn({})).toThrow(SystemError);
    expect(() => readNotePurgeTurn({ noteId: "" })).toThrow(SystemError);
    // Whitespace names no note either: `NoteId.create` trims before it
    // judges, so a guard that only rejected `""` would hand this one to
    // the value object and answer a corrupt row with a business rule.
    expect(() => readNotePurgeTurn({ noteId: "   " })).toThrow(SystemError);
    expect(() => readNotePurgeTurn({ noteId: 12 })).toThrow(SystemError);
    expect(() =>
      readNotePurgeTurn({ noteId: "note-1", deletionOperationId: 12 }),
    ).toThrow(SystemError);
    // A blank token is unreadable, not "no barrier": absence is written
    // as `null` or as no field at all, so reading `""` as `null` would
    // skip admission and re-arm at the wrong priority.
    expect(() =>
      readNotePurgeTurn({ noteId: "note-1", deletionOperationId: "" }),
    ).toThrow(SystemError);
    expect(() =>
      readNotePurgeTurn({ noteId: "note-1", deletionOperationId: "   " }),
    ).toThrow(SystemError);

    for (const payload of [
      { noteId: "   " },
      { noteId: "note-1", deletionOperationId: 12 },
      { noteId: "note-1", deletionOperationId: "" },
    ]) {
      try {
        readNotePurgeTurn(payload);
        expect.unreachable("the corrupt payload should have faulted");
      } catch (cause) {
        expect(cause).toBeInstanceOf(SystemError);
        expect((cause as SystemError).code).toBe(
          SystemErrorCode.DataIntegrityError,
        );
      }
    }
  });

  it("reads an absent or null deletion token as `null`, so an ordinary purge carries no barrier", () => {
    expect(readNotePurgeTurn({ noteId: "note-1" })).toEqual({
      noteId: "note-1",
      deletionOperationId: null,
    });
    expect(
      readNotePurgeTurn({ noteId: "note-1", deletionOperationId: null }),
    ).toEqual({ noteId: "note-1", deletionOperationId: null });
    expect(
      readNotePurgeTurn({ noteId: "note-1", deletionOperationId: "op-1" }),
    ).toEqual({ noteId: "note-1", deletionOperationId: "op-1" });
  });
});

describe("identity.personalBarrierPruneContinued", () => {
  const DAY_MS = 24 * 60 * 60 * 1000;
  const OWNER = UserId.create("user-barrier");
  const SCOPE = ScopeKey.user(OWNER);
  const OPERATION_ID = "op-barrier";

  const armPrune = async (
    h: TestHarness,
    retainUntil: Date,
    payload: ScopeTaskPayload,
    dueAt: Date,
  ): Promise<void> => {
    await h.container.scopeUnitOfWorkProvider.run(SCOPE, async (ctx) => {
      await ctx.cleanupAdmission.beginPersonalAccountDeletion(
        OPERATION_ID,
        OWNER,
      );
      for (const component of REQUIRED_PERSONAL_CLEANUP_COMPONENTS) {
        await ctx.cleanupAdmission.acknowledgePersonalComponent(
          OPERATION_ID,
          component,
        );
      }
      await ctx.cleanupAdmission.markCompleted(OPERATION_ID, retainUntil);
      await ctx.scopeTaskScheduler.schedule({
        kind: PERSONAL_BARRIER_PRUNE_TASK_KIND,
        operationId: OPERATION_ID,
        priority: ScopeTaskPriority.expiryCollection,
        dueAt,
        payload,
      });
    });
  };

  const receipts = (h: TestHarness) =>
    h.backend.scope(SCOPE).cleanupReceipts.values();

  it("sweeps against the deadline the row carries, so a receipt whose retention outlasts it is left standing", async () => {
    const h = createTestHarness();
    const armedAt = h.clock.now();
    const asOf = new Date(armedAt.getTime() + 60 * DAY_MS);
    await armPrune(
      h,
      new Date(armedAt.getTime() + 120 * DAY_MS),
      { deletionOperationId: OPERATION_ID, asOf: asOf.toISOString() },
      asOf,
    );
    // The turn runs long after its row came due, which is exactly when
    // the clock and the row's own deadline disagree.
    h.clock.advance(200 * DAY_MS);

    await runDueScopeTasks(h.workerContainer);

    expect(receipts(h)).toHaveLength(1);
  });

  it("falls back to the clock when the row names no readable deadline, rather than stranding the row", async () => {
    for (const asOf of [undefined, "not-a-date", 12]) {
      const h = createTestHarness();
      const armedAt = h.clock.now();
      await armPrune(
        h,
        new Date(armedAt.getTime() + 120 * DAY_MS),
        asOf === undefined
          ? { deletionOperationId: OPERATION_ID }
          : { deletionOperationId: OPERATION_ID, asOf },
        new Date(armedAt.getTime() + 120 * DAY_MS),
      );
      h.clock.advance(200 * DAY_MS);

      await runDueScopeTasks(h.workerContainer);

      expect(receipts(h)).toEqual([]);
      // The fallback is the half of the convention the sweep's own
      // result cannot show: a turn that read the deadline and one that
      // invented it both reclaim the same receipts, so the warn is the
      // only record that the row lost its position.
      expect(h.logger.byLevel("warn").map((entry) => entry.message)).toContain(
        "[scope-tasks] barrier prune payload names no readable deadline; sweeping against the clock",
      );
    }
  });

  it("says nothing when the row names its deadline, so the fallback stays a signal", async () => {
    const h = createTestHarness();
    const armedAt = h.clock.now();
    const asOf = new Date(armedAt.getTime() + 60 * DAY_MS);
    await armPrune(
      h,
      new Date(armedAt.getTime() + 120 * DAY_MS),
      { deletionOperationId: OPERATION_ID, asOf: asOf.toISOString() },
      asOf,
    );
    h.clock.advance(200 * DAY_MS);

    await runDueScopeTasks(h.workerContainer);

    expect(h.logger.byLevel("warn")).toEqual([]);
  });
});

/**
 * `identity.accountDeletionDispatchContinued` is the only event type
 * with more than one sibling that actually does work in the same turn:
 * the `cleanup` phase is served by `accountDeletionCleanup` (scope
 * plane) and `accountDeletionGlobalCleanup` (global plane). The
 * dispatcher does not depend on registration order, so the JSDoc's
 * claim that these two are independent has to be exercised on the real
 * registry rather than on a synthetic one.
 */
describe("identity.accountDeletionDispatchContinued siblings", () => {
  const EMAIL = "sibling@example.com";
  const REQUEST_ID = "22222222-2222-4222-8222-222222222222";

  const cleanupDispatch = (
    operationId: string,
  ): AccountDeletionDispatchContinuedEvent => ({
    id: EventId.create("event-4"),
    ...IdentityContinuations.accountDeletionDispatch(
      { operationId, phase: "cleanup" },
      new Date("2026-01-01T00:00:00.000Z"),
    ),
  });

  async function acceptAndBuild(h: TestHarness): Promise<string> {
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
    return view.operationId;
  }

  it("runs the global half of the cleanup wave even when the personal half fails first, and still fails the delivery", async () => {
    const h = createTestHarness();
    const operationId = await acceptAndBuild(h);

    // The window: the scope plane is down for the whole delivery, so
    // `accountDeletionCleanup` — the sibling registered first — throws
    // on its very first read. The global half touches only the global
    // plane and the manifest store, so nothing but the dispatcher can
    // carry the failure across.
    const scopePlaneDown: ScopeUnitOfWorkProvider = {
      run: () => {
        throw new SystemError(
          SystemErrorCode.DatabaseError,
          "scope plane unreachable",
        );
      },
    };

    await expect(
      dispatchDomainEvent(cleanupDispatch(operationId), {
        ...h.workerContainer,
        scopeUnitOfWorkProvider: scopePlaneDown,
      }),
    ).rejects.toThrow("scope plane unreachable");

    const receipts = h.backend.manifestHeaders.get(operationId)?.receipts ?? [];
    expect(receipts).not.toContain("personalCleanup");
    expect(receipts).toContain("uniquenessRelease");
    expect(
      h.logger
        .byLevel("error")
        .map((entry) => entry.message)
        .filter((message) => message.startsWith("[subscribers] ")),
    ).toEqual([
      "[subscribers] identity.accountDeletionCleanup failed for identity.accountDeletionDispatchContinued",
    ]);
  });
});
