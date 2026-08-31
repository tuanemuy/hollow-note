import {
  isConflictError,
  isSystemError,
  SystemError,
  SystemErrorCode,
} from "@repo/core/application/errors";
import { ScopeTaskPriority } from "@repo/core/application/ports/scopeTaskScheduler";
import { ScopeKey } from "@repo/core/application/scope";
import { UserId } from "@repo/core/domain/identity/valueObject";
import { BackupRecord } from "@repo/core/domain/integration/backupRecord";
import { NoteId } from "@repo/core/domain/note/valueObject";
import { WorkspaceId } from "@repo/core/domain/workspace/valueObject";
import { describe, expect, it } from "vitest";
import { createTestHarness, type TestHarness } from "../../__tests__/helpers";
import { REQUIRED_PERSONAL_CLEANUP_COMPONENTS } from "../../cleanup/participants";
import type { ScopeUnitOfWorkContext } from "../../execution/unitOfWork";
import { runDueScopeTasks } from "../../workers/scopeTaskRunner";
import {
  deleteBackupRecordsForNote,
  NOTE_BACKUP_DELETE_BATCH_SIZE,
  NOTE_BACKUP_DELETE_TASK_KIND,
} from "../deleteBackupRecordsForNote";

const userId = UserId.create("user-1");
const otherUserId = UserId.create("user-2");
const scope = ScopeKey.user(userId);
const workspaceScope = ScopeKey.workspace(WorkspaceId.create("workspace-1"));
const NOTE = NoteId.create("note-1");
const OTHER_NOTE = NoteId.create("note-2");
const PURGE_OPERATION = "purge-note-1";
const DELETION_OPERATION = "deletion-1";

const record = (
  n: number,
  noteId: NoteId,
  owner: UserId = userId,
): BackupRecord =>
  BackupRecord.reconstruct({
    id: `backup-${String(n).padStart(3, "0")}`,
    userId: owner,
    noteId,
    sourceFileId: `file-${n}`,
    externalFileId: `drive-${n}`,
    webViewUrl: `https://drive.example.test/${n}`,
    checksumValue: "c".repeat(64),
    version: 0,
    backedUpAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  });

async function seed(
  h: TestHarness,
  rows: readonly BackupRecord[],
  target: ScopeKey = scope,
): Promise<void> {
  await h.container.scopeUnitOfWorkProvider.run(target, async (ctx) => {
    for (const row of rows) {
      await ctx.backupRecordRepository.insert(row);
    }
  });
}

const openBarrier = (h: TestHarness) =>
  h.container.scopeUnitOfWorkProvider.run(scope, (ctx) =>
    ctx.cleanupAdmission.beginPersonalAccountDeletion(
      DELETION_OPERATION,
      userId,
    ),
  );

/**
 * Drives the barrier to where `deleteNotesForOwner`'s last turn leaves
 * it: every required component acknowledged and the receipt completed,
 * with the `note.purged` of the notes it counted still queued for the
 * relay.
 */
const completeBarrier = (h: TestHarness) =>
  h.container.scopeUnitOfWorkProvider.run(scope, async (ctx) => {
    for (const component of REQUIRED_PERSONAL_CLEANUP_COMPONENTS) {
      await ctx.cleanupAdmission.acknowledgePersonalComponent(
        DELETION_OPERATION,
        component,
      );
    }
    await ctx.cleanupAdmission.markCompleted(
      DELETION_OPERATION,
      new Date("2026-05-01T00:00:00.000Z"),
    );
  });

const run = (
  h: TestHarness,
  deletionOperationId: string | null = null,
  target: ScopeKey = scope,
) =>
  deleteBackupRecordsForNote({
    container: h.workerContainer,
    input: {
      noteId: NOTE,
      scope: target,
      operationId: PURGE_OPERATION,
      deletionOperationId,
    },
  });

const recordIds = (
  h: TestHarness,
  target: ScopeKey = scope,
): readonly string[] =>
  h.backend
    .scope(target)
    .backupRecords.values()
    .map((row) => row.id)
    .sort();

const tasks = (h: TestHarness) =>
  h.backend.scope(scope).scheduledTasks.values();

describe("deleteBackupRecordsForNote", () => {
  it("TC-integration-016: drops every record of the purged note", async () => {
    const h = createTestHarness();
    await seed(h, [record(1, NOTE), record(2, NOTE)]);

    const view = await run(h);

    expect(view.deletedCount).toBe(2);
    expect(recordIds(h)).toEqual([]);
  });

  it("TC-integration-017: leaves the copies in the owner's Drive alone", async () => {
    const h = createTestHarness();
    await seed(h, [record(1, NOTE)]);

    await run(h);

    // Nothing leaves the scope object: no event is emitted that a
    // Drive-touching subscriber could act on (IN-09).
    expect(h.backend.outbox.values()).toEqual([]);
    expect(h.backend.objects.values()).toEqual([]);
  });

  it("TC-integration-018: leaves another note's records in place", async () => {
    const h = createTestHarness();
    await seed(h, [record(1, NOTE), record(2, OTHER_NOTE)]);

    const view = await run(h);

    expect(view.deletedCount).toBe(1);
    expect(recordIds(h)).toEqual(["backup-002"]);
  });

  it("TC-integration-019: takes the records of every member, not just the purge's actor", async () => {
    const h = createTestHarness();
    await seed(h, [record(1, NOTE), record(2, NOTE, otherUserId)]);

    const view = await run(h);

    expect(view.deletedCount).toBe(2);
    expect(recordIds(h)).toEqual([]);
  });

  it("TC-integration-020: succeeds with nothing to do for a note that was never backed up", async () => {
    const h = createTestHarness();

    const view = await run(h);

    expect(view.deletedCount).toBe(0);
    expect(tasks(h)).toEqual([]);
  });

  it("TC-integration-021: is a no-op on redelivery, since deleted records do not come back", async () => {
    const h = createTestHarness();
    await seed(h, [record(1, NOTE), record(2, NOTE)]);

    const first = await run(h);
    const second = await run(h);

    expect(first.deletedCount).toBe(2);
    expect(second.deletedCount).toBe(0);
    expect(recordIds(h)).toEqual([]);
  });

  it("TC-integration-022: reclaims a workspace note's records through the same path", async () => {
    const h = createTestHarness();
    await seed(h, [record(1, NOTE, otherUserId)], workspaceScope);

    const view = await run(h, null, workspaceScope);

    expect(view.deletedCount).toBe(1);
    expect(recordIds(h, workspaceScope)).toEqual([]);
  });

  it("TC-integration-023: reclaims 250 records a page at a time, each turn carrying the same deletion token", async () => {
    const h = createTestHarness();
    await seed(
      h,
      Array.from({ length: 250 }, (_, n) => record(n + 1, NOTE)),
    );
    await openBarrier(h);

    const first = await run(h, DELETION_OPERATION);
    expect(first.deletedCount).toBe(NOTE_BACKUP_DELETE_BATCH_SIZE);
    expect(
      tasks(h).map((task) => ({
        kind: task.kind,
        operationId: task.operationId,
        priority: task.priority,
        payload: task.payload,
      })),
    ).toEqual([
      {
        kind: NOTE_BACKUP_DELETE_TASK_KIND,
        operationId: PURGE_OPERATION,
        priority: ScopeTaskPriority.securityCleanup,
        payload: { noteId: NOTE, deletionOperationId: DELETION_OPERATION },
      },
    ]);

    expect((await run(h, DELETION_OPERATION)).deletedCount).toBe(
      NOTE_BACKUP_DELETE_BATCH_SIZE,
    );
    expect(tasks(h)).toHaveLength(1);

    expect((await run(h, DELETION_OPERATION)).deletedCount).toBe(50);
    expect(recordIds(h)).toEqual([]);
    expect(tasks(h)).toEqual([]);
  });

  it("TC-integration-023: has its continuation resumed by the scope-task runner, so an unregistered kind cannot strand the rest", async () => {
    const h = createTestHarness();
    await seed(
      h,
      Array.from({ length: NOTE_BACKUP_DELETE_BATCH_SIZE + 1 }, (_, n) =>
        record(n + 1, NOTE),
      ),
    );

    await run(h);
    expect(tasks(h)).toHaveLength(1);

    const round = await runDueScopeTasks(h.workerContainer);

    expect(round.processed).toBe(1);
    expect(recordIds(h)).toEqual([]);
    expect(tasks(h)).toEqual([]);
  });

  it("TC-integration-024: proceeds only for the cleanup owner of the scope", async () => {
    const h = createTestHarness();
    await seed(h, [record(1, NOTE)]);
    await openBarrier(h);

    expect((await run(h, DELETION_OPERATION)).deletedCount).toBe(1);

    await seed(h, [record(2, NOTE)]);
    const refused = await run(h, "deletion-9").then(
      () => null,
      (thrown: unknown) => thrown,
    );
    expect(isConflictError(refused)).toBe(true);
    expect(recordIds(h)).toEqual(["backup-002"]);
  });

  it("TC-integration-024: still reclaims the rows once the deletion barrier it inherited has completed", async () => {
    const h = createTestHarness();
    await seed(
      h,
      Array.from({ length: NOTE_BACKUP_DELETE_BATCH_SIZE + 1 }, (_, n) =>
        record(n + 1, NOTE),
      ),
    );
    await openBarrier(h);
    // The component that completes the barrier is `note` itself, so the
    // barrier is already `completed` by the time the relay delivers the
    // `note.purged` of the notes it counted. Refusing the follower here
    // would quarantine the outbox row and fail the continuation task,
    // and nothing else reclaims backup records.
    await completeBarrier(h);

    const first = await run(h, DELETION_OPERATION);
    expect(first.deletedCount).toBe(NOTE_BACKUP_DELETE_BATCH_SIZE);
    expect(tasks(h)).toHaveLength(1);

    const round = await runDueScopeTasks(h.workerContainer);

    expect(round.processed).toBe(1);
    expect(recordIds(h)).toEqual([]);
    expect(tasks(h)).toEqual([]);
  });

  it("TC-integration-025: lets a write failure through so the relay redelivers", async () => {
    const h = createTestHarness();
    await seed(h, [record(1, NOTE)]);
    const real = h.workerContainer.scopeUnitOfWorkProvider;

    const error = await deleteBackupRecordsForNote({
      container: {
        ...h.workerContainer,
        scopeUnitOfWorkProvider: {
          run: <T>(
            target: ScopeKey,
            fn: (ctx: ScopeUnitOfWorkContext) => Promise<T>,
          ) =>
            real.run(target, (ctx) =>
              fn({
                ...ctx,
                backupRecordRepository: {
                  ...ctx.backupRecordRepository,
                  deleteByNote: () =>
                    Promise.reject(
                      new SystemError(
                        SystemErrorCode.DatabaseError,
                        "write failed",
                      ),
                    ),
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
    }).then(
      () => null,
      (thrown: unknown) => thrown,
    );

    expect(isSystemError(error)).toBe(true);
    expect(isSystemError(error) && error.code).toBe(
      SystemErrorCode.DatabaseError,
    );
    expect(recordIds(h)).toEqual(["backup-001"]);
  });
});
