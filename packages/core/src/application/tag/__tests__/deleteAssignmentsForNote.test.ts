import {
  isConflictError,
  isSystemError,
  SystemError,
  SystemErrorCode,
} from "@repo/core/application/errors";
import { ScopeTaskPriority } from "@repo/core/application/ports/scopeTaskScheduler";
import { ScopeKey } from "@repo/core/application/scope";
import { UserId } from "@repo/core/domain/identity/valueObject";
import { NoteId } from "@repo/core/domain/note/valueObject";
import { TagAssignment } from "@repo/core/domain/tag/tagAssignment";
import { describe, expect, it } from "vitest";
import { createTestHarness, type TestHarness } from "../../__tests__/helpers";
import type { ScopeUnitOfWorkContext } from "../../execution/unitOfWork";
import { runDueScopeTasks } from "../../workers/scopeTaskRunner";
import {
  deleteAssignmentsForNote,
  NOTE_ASSIGNMENT_DELETE_BATCH_SIZE,
  NOTE_ASSIGNMENT_DELETE_TASK_KIND,
} from "../deleteAssignmentsForNote";

const userId = UserId.create("user-1");
const scope = ScopeKey.user(userId);
const NOTE = NoteId.create("note-1");
const OTHER_NOTE = NoteId.create("note-2");
const PURGE_OPERATION = "purge-note-1";
const DELETION_OPERATION = "deletion-1";

const assignment = (n: number, tag: number, noteId: NoteId): TagAssignment =>
  TagAssignment.reconstruct({
    id: `assignment-${String(n).padStart(3, "0")}`,
    tagId: `tag-${tag}`,
    noteId,
    scopeType: "user",
    scopeId: userId,
    assignedBy: userId,
    assignedAt: new Date("2026-01-01T00:00:00.000Z"),
  });

async function seed(
  h: TestHarness,
  rows: readonly TagAssignment[],
): Promise<void> {
  await h.container.scopeUnitOfWorkProvider.run(scope, async (ctx) => {
    for (const row of rows) {
      await ctx.tagAssignmentRepository.insert(row);
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

const run = (h: TestHarness, deletionOperationId: string | null = null) =>
  deleteAssignmentsForNote({
    container: h.workerContainer,
    input: {
      noteId: NOTE,
      scope,
      operationId: PURGE_OPERATION,
      deletionOperationId,
    },
  });

const assignmentIds = (h: TestHarness): readonly string[] =>
  h.backend
    .scope(scope)
    .tagAssignments.values()
    .map((row) => row.id)
    .sort();

const tasks = (h: TestHarness) =>
  h.backend.scope(scope).scheduledTasks.values();

describe("deleteAssignmentsForNote", () => {
  it("TC-tag-023: drops every assignment of the purged note", async () => {
    const h = createTestHarness();
    await seed(
      h,
      [1, 2, 3, 4, 5].map((n) => assignment(n, n, NOTE)),
    );

    const view = await run(h);

    expect(view.deletedCount).toBe(5);
    expect(assignmentIds(h)).toEqual([]);
  });

  it("TC-tag-024: touches nothing but the assignments — tag vocabulary is `deleteUnusedTags`'s business", async () => {
    const h = createTestHarness();
    await seed(h, [assignment(1, 1, NOTE), assignment(2, 1, OTHER_NOTE)]);
    const store = h.backend.scope(scope);
    const before = Object.entries(store).flatMap(([name, table]) =>
      typeof table === "object" && table !== null && "values" in table
        ? [[name, table.values().length] as const]
        : [],
    );

    await run(h);

    const after = Object.entries(store).flatMap(([name, table]) =>
      typeof table === "object" && table !== null && "values" in table
        ? [[name, table.values().length] as const]
        : [],
    );
    expect(
      after.filter(
        ([name, count]) =>
          before.find(([other]) => other === name)?.[1] !== count,
      ),
    ).toEqual([["tagAssignments", 1]]);
  });

  it("TC-tag-025: leaves the same tag on another note in place", async () => {
    const h = createTestHarness();
    await seed(h, [assignment(1, 7, NOTE), assignment(2, 7, OTHER_NOTE)]);

    const view = await run(h);

    expect(view.deletedCount).toBe(1);
    expect(assignmentIds(h)).toEqual(["assignment-002"]);
  });

  it("TC-tag-026: emits nothing — the read-model rows go with the purge itself", async () => {
    const h = createTestHarness();
    await seed(h, [assignment(1, 1, NOTE)]);

    await run(h);

    expect(h.backend.outbox.values()).toEqual([]);
  });

  it("TC-tag-027: reclaims 450 assignments 200 at a time, re-checking the deletion owner every turn", async () => {
    const h = createTestHarness();
    await seed(
      h,
      Array.from({ length: 450 }, (_, n) => assignment(n + 1, n + 1, NOTE)),
    );
    await openBarrier(h);

    const first = await run(h, DELETION_OPERATION);
    expect(first.deletedCount).toBe(NOTE_ASSIGNMENT_DELETE_BATCH_SIZE);
    expect(
      tasks(h).map((task) => ({
        kind: task.kind,
        operationId: task.operationId,
        priority: task.priority,
        payload: task.payload,
      })),
    ).toEqual([
      {
        kind: NOTE_ASSIGNMENT_DELETE_TASK_KIND,
        operationId: PURGE_OPERATION,
        priority: ScopeTaskPriority.securityCleanup,
        payload: { noteId: NOTE, deletionOperationId: DELETION_OPERATION },
      },
    ]);

    const second = await run(h, DELETION_OPERATION);
    expect(second.deletedCount).toBe(NOTE_ASSIGNMENT_DELETE_BATCH_SIZE);
    expect(tasks(h)).toHaveLength(1);

    // The ownership check is per turn, not per operation: withdrawing
    // the barrier stops the next one.
    await h.container.scopeUnitOfWorkProvider.run(scope, (ctx) =>
      ctx.cleanupAdmission.abortPersonalAccountDeletion(DELETION_OPERATION),
    );
    const refused = await run(h, DELETION_OPERATION).then(
      () => null,
      (thrown: unknown) => thrown,
    );
    expect(isConflictError(refused)).toBe(true);
    expect(assignmentIds(h)).toHaveLength(50);

    await openBarrier(h);
    const third = await run(h, DELETION_OPERATION);
    expect(third.deletedCount).toBe(50);
    expect(tasks(h)).toEqual([]);
  });

  it("TC-tag-027: has its continuation resumed by the scope-task runner, so an unregistered kind cannot strand the rest", async () => {
    const h = createTestHarness();
    await seed(
      h,
      Array.from({ length: NOTE_ASSIGNMENT_DELETE_BATCH_SIZE + 1 }, (_, n) =>
        assignment(n + 1, n + 1, NOTE),
      ),
    );

    await run(h);
    expect(tasks(h)).toHaveLength(1);

    const round = await runDueScopeTasks(h.workerContainer);

    expect(round.processed).toBe(1);
    expect(assignmentIds(h)).toEqual([]);
    expect(tasks(h)).toEqual([]);
  });

  it("TC-tag-028: proceeds under a personal account deletion that owns the scope", async () => {
    const h = createTestHarness();
    await seed(h, [assignment(1, 1, NOTE)]);
    await openBarrier(h);

    expect((await run(h, DELETION_OPERATION)).deletedCount).toBe(1);
  });

  it("TC-tag-029: succeeds with nothing to do for a note that carries no tag", async () => {
    const h = createTestHarness();

    const view = await run(h);

    expect(view.deletedCount).toBe(0);
    expect(tasks(h)).toEqual([]);
  });

  it("TC-tag-030: is a no-op on redelivery, since deleted assignments do not come back", async () => {
    const h = createTestHarness();
    await seed(h, [assignment(1, 1, NOTE), assignment(2, 2, NOTE)]);

    const first = await run(h);
    const second = await run(h);

    expect(first.deletedCount).toBe(2);
    expect(second.deletedCount).toBe(0);
    expect(assignmentIds(h)).toEqual([]);
  });

  it("TC-tag-031: ends harmlessly when a scope-wide tag sweep already took the rows", async () => {
    const h = createTestHarness();
    await seed(h, [assignment(1, 1, NOTE)]);
    // Stands in for `deleteTagsForScope` having removed the assignments
    // first: the order of the two is not fixed, and neither depends on it.
    await h.container.scopeUnitOfWorkProvider.run(scope, (ctx) =>
      ctx.tagAssignmentRepository.deleteByNote(NOTE, 200),
    );

    expect((await run(h)).deletedCount).toBe(0);
  });

  it("TC-tag-032: lets a write failure through so the relay redelivers", async () => {
    const h = createTestHarness();
    await seed(h, [assignment(1, 1, NOTE)]);
    const real = h.workerContainer.scopeUnitOfWorkProvider;

    const error = await deleteAssignmentsForNote({
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
                tagAssignmentRepository: {
                  ...ctx.tagAssignmentRepository,
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
    expect(assignmentIds(h)).toEqual(["assignment-001"]);
  });
});
