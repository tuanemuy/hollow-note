import { SystemError, SystemErrorCode } from "@repo/core/application/errors";
import type { ScopeKey } from "@repo/core/application/scope";
import { UserId } from "@repo/core/domain/identity/valueObject";
import { describe, expect, it } from "vitest";
import {
  deleteNotesForOwner,
  NOTE_OWNER_PURGE_TASK_KIND,
  OWNER_PURGE_BATCH_SIZE,
} from "../deleteNotesForOwner";
import { trashNote } from "../trashNote";
import {
  createPersonalNote,
  createTestHarness,
  createWorkspaceNote,
  eventsOfType,
  MEMBER,
  OWNER,
  outboxTypes,
  seedWorkspace,
  type TestHarness,
  userScope,
  workspaceScope,
} from "./editingHarness";

const OPERATION_ID = "deletion-operation-1";

const beginCleanup = (
  h: TestHarness,
  scope: ScopeKey = userScope,
  operationId: string = OPERATION_ID,
): Promise<void> =>
  h.container.scopeUnitOfWorkProvider.run(scope, (ctx) =>
    ctx.cleanupAdmission.beginPersonalAccountDeletion(
      operationId,
      UserId.create(OWNER),
    ),
  );

const run = (
  h: TestHarness,
  options: Readonly<{
    scope?: ScopeKey;
    batchSize?: number;
    container?: TestHarness["container"];
  }> = {},
) =>
  deleteNotesForOwner({
    container: options.container ?? h.container,
    input: {
      deletionOperationId: OPERATION_ID,
      scope: options.scope ?? userScope,
      ...(options.batchSize === undefined
        ? {}
        : { batchSize: options.batchSize }),
    },
  });

async function createPersonalNotes(
  h: TestHarness,
  count: number,
): Promise<readonly string[]> {
  const ids: string[] = [];
  for (let i = 0; i < count; i += 1) {
    ids.push(await createPersonalNote(h));
  }
  return ids;
}

const trash = (h: TestHarness, noteId: string) =>
  trashNote({
    container: h.container,
    input: { noteId, userId: OWNER, expectedVersion: 0, excludingJobId: null },
  });

const tasks = (h: TestHarness, scope: ScopeKey = userScope) =>
  h.backend.scope(scope).scheduledTasks.values();

const remainingNotes = (h: TestHarness, scope: ScopeKey = userScope): number =>
  h.backend.scope(scope).notes.keys().length;

/** Fails every route claim, so no note of the batch can be purged. */
const withBrokenRouteStore = (
  h: TestHarness,
  matches: (noteId: string) => boolean = () => true,
): TestHarness["container"] => ({
  ...h.container,
  noteRouteStore: {
    ...h.container.noteRouteStore,
    beginPurge: async (
      params: Parameters<typeof h.container.noteRouteStore.beginPurge>[0],
    ) => {
      if (matches(params.noteId)) {
        throw new SystemError(
          SystemErrorCode.DatabaseError,
          "route store unavailable",
        );
      }
      return h.container.noteRouteStore.beginPurge(params);
    },
  },
});

describe("deleteNotesForOwner", () => {
  it("TC-note-067: purges every personal note, trashed ones included, and emits one note.purged each", async () => {
    const h = createTestHarness();
    const ids = await createPersonalNotes(h, 10);
    await trash(h, ids[0]);
    await trash(h, ids[1]);
    await beginCleanup(h);

    const view = await run(h);

    expect(view.status).toBe("settled");
    expect(view.purgedCount).toBe(10);
    expect(remainingNotes(h)).toBe(0);
    expect(eventsOfType(h, "note.purged")).toHaveLength(10);
  });

  it("TC-note-068: takes an owner whose notes are all in the trash", async () => {
    const h = createTestHarness();
    for (const noteId of await createPersonalNotes(h, 3)) {
      await trash(h, noteId);
    }
    await beginCleanup(h);

    const view = await run(h);

    expect(view.purgedCount).toBe(3);
    expect(remainingNotes(h)).toBe(0);
  });

  it("TC-note-069: leaves the workspace notes the leaving user authored", async () => {
    const h = createTestHarness();
    await seedWorkspace(h, [{ userId: OWNER, role: "owner" }]);
    const personal = await createPersonalNote(h);
    const workspaceNote = await createWorkspaceNote(h);
    await beginCleanup(h);

    const view = await run(h);

    expect(view.purgedCount).toBe(1);
    expect(h.backend.scope(userScope).notes.get(personal)).toBeUndefined();
    expect(
      h.backend.scope(workspaceScope).notes.get(workspaceNote),
    ).toBeDefined();
  });

  it("TC-note-070: purges the notes of a deleted workspace", async () => {
    const h = createTestHarness();
    await seedWorkspace(h, [{ userId: OWNER, role: "owner" }]);
    await createWorkspaceNote(h);
    await createWorkspaceNote(h);
    await beginCleanup(h, workspaceScope);

    const view = await run(h, { scope: workspaceScope });

    expect(view.purgedCount).toBe(2);
    expect(remainingNotes(h, workspaceScope)).toBe(0);
  });

  it("TC-note-071: leaves the members' personal notes when a workspace is deleted", async () => {
    const h = createTestHarness();
    await seedWorkspace(h, [
      { userId: OWNER, role: "owner" },
      { userId: MEMBER, role: "editor" },
    ]);
    await createWorkspaceNote(h);
    const personal = await createPersonalNote(h);
    await beginCleanup(h, workspaceScope);

    await run(h, { scope: workspaceScope });

    expect(h.backend.scope(userScope).notes.get(personal)).toBeDefined();
  });

  it("TC-note-072: hands the follow-up cleanup its own note.purged with the deletion token", async () => {
    const h = createTestHarness();
    const [noteId] = await createPersonalNotes(h, 1);
    await beginCleanup(h);

    await run(h);

    const [event] = eventsOfType(h, "note.purged");
    expect(event.payload).toMatchObject({
      noteId,
      owner: { type: "user", userId: OWNER },
      deletionOperationId: OPERATION_ID,
    });
  });

  it("TC-note-073: settles without a continuation when the targets fill the batch exactly", async () => {
    const h = createTestHarness();
    await createPersonalNotes(h, 4);
    await beginCleanup(h);

    const view = await run(h, { batchSize: 4 });

    expect(view.status).toBe("settled");
    expect(view.purgedCount).toBe(4);
    expect(tasks(h)).toHaveLength(0);
  });

  it("TC-note-074: purges one batch and arms a continuation for the rest", async () => {
    const h = createTestHarness();
    await createPersonalNotes(h, 5);
    await beginCleanup(h);

    const view = await run(h, { batchSize: 4 });

    expect(view.status).toBe("continued");
    expect(view.purgedCount).toBe(4);
    expect(remainingNotes(h)).toBe(1);
    expect(tasks(h)).toEqual([
      expect.objectContaining({
        kind: NOTE_OWNER_PURGE_TASK_KIND,
        operationId: OPERATION_ID,
        payload: { deletionOperationId: OPERATION_ID },
        attempt: 0,
      }),
    ]);
  });

  it("TC-note-075: arms exactly one continuation and re-publishes no deletion event", async () => {
    const h = createTestHarness();
    await createPersonalNotes(h, 5);
    await beginCleanup(h);

    await run(h, { batchSize: 2 });

    expect(
      tasks(h).filter((task) => task.kind === NOTE_OWNER_PURGE_TASK_KIND),
    ).toHaveLength(1);
    // The continuation travels as a scope task, not as a second copy of
    // the deletion event that started this — that would fan out to every
    // one of its subscribers again.
    expect(outboxTypes(h)).not.toContain("identity.user.deleted");
    expect(outboxTypes(h)).not.toContain("workspace.deleted");
  });

  it("TC-note-076: resumes from the start of what is left, carrying no cursor", async () => {
    const h = createTestHarness();
    await createPersonalNotes(h, 5);
    await beginCleanup(h);
    await run(h, { batchSize: 2 });
    await run(h, { batchSize: 2 });

    const view = await run(h, { batchSize: 2 });

    expect(view.status).toBe("settled");
    expect(view.purgedCount).toBe(1);
    expect(remainingNotes(h)).toBe(0);
    expect(tasks(h)).toHaveLength(0);
  });

  it("TC-note-077: backs its own row off instead of breeding a continuation when nothing could be purged", async () => {
    const h = createTestHarness();
    await createPersonalNotes(h, 3);
    await beginCleanup(h);

    const view = await run(h, { container: withBrokenRouteStore(h) });

    expect(view.status).toBe("stalled");
    expect(view.purgedCount).toBe(0);
    expect(remainingNotes(h)).toBe(3);
    expect(tasks(h)).toEqual([
      expect.objectContaining({
        kind: NOTE_OWNER_PURGE_TASK_KIND,
        operationId: OPERATION_ID,
        // Backed off, not freshly scheduled: the row carries an attempt
        // so the ceiling can eventually park it as `failed`.
        attempt: 1,
      }),
    ]);
  });

  it("TC-note-078: converges when two continuation series run at once", async () => {
    const h = createTestHarness();
    await createPersonalNotes(h, 4);
    await beginCleanup(h);

    const [first, second] = await Promise.all([run(h), run(h)]);

    // Both series read the same four notes and both end settled: the
    // second one's purges resume operations the first already finished,
    // which is a no-op that emits nothing. What must not double is the
    // effect, so the event is the assertion, not the count either
    // series reports.
    expect(first.status).toBe("settled");
    expect(second.status).toBe("settled");
    expect(remainingNotes(h)).toBe(0);
    expect(eventsOfType(h, "note.purged")).toHaveLength(4);
    expect(tasks(h)).toHaveLength(0);
  });

  it("TC-note-079: caps an oversized batch at the fan-out budget of one turn", async () => {
    const h = createTestHarness();
    await createPersonalNotes(h, 3);
    await beginCleanup(h);
    const limits: number[] = [];
    const reader = h.container.noteReaderFor(userScope);
    const container = {
      ...h.container,
      noteReaderFor: () => ({
        ...reader,
        listByOwner: (
          owner: Parameters<typeof reader.listByOwner>[0],
          lifecycle: Parameters<typeof reader.listByOwner>[1],
          pagination: Parameters<typeof reader.listByOwner>[2],
        ) => {
          limits.push(pagination.limit);
          return reader.listByOwner(owner, lifecycle, pagination);
        },
      }),
    };

    await run(h, { batchSize: 5000, container });

    expect(limits).toEqual([OWNER_PURGE_BATCH_SIZE]);
    expect(OWNER_PURGE_BATCH_SIZE).toBe(100);
  });

  it("TC-note-080: succeeds without doing anything when the scope holds no note", async () => {
    const h = createTestHarness();
    await beginCleanup(h);

    const view = await run(h);

    expect(view).toEqual({
      status: "settled",
      personalCleanupCompleted: false,
      purgedCount: 0,
    });
    expect(tasks(h)).toHaveLength(0);
  });

  it("TC-note-081: records one note's failure and carries on with the rest", async () => {
    const h = createTestHarness();
    const ids = await createPersonalNotes(h, 3);
    const doomed = ids[1];
    await beginCleanup(h);

    const view = await run(h, {
      container: withBrokenRouteStore(h, (noteId) => noteId === doomed),
    });

    expect(view.purgedCount).toBe(2);
    expect(view.status).toBe("continued");
    expect(h.backend.scope(userScope).notes.keys()).toEqual([doomed]);
  });

  it("TC-note-082: is idempotent — a redelivered command finds nothing left", async () => {
    const h = createTestHarness();
    await createPersonalNotes(h, 3);
    await beginCleanup(h);
    await run(h);

    const second = await run(h);

    expect(second.status).toBe("settled");
    expect(second.purgedCount).toBe(0);
    expect(eventsOfType(h, "note.purged")).toHaveLength(3);
  });

  it("refuses a command from an operation that does not own the scope", async () => {
    const h = createTestHarness();
    await createPersonalNotes(h, 1);
    await beginCleanup(h, userScope, "another-operation");

    await expect(run(h)).rejects.toThrow();
    expect(remainingNotes(h)).toBe(1);
  });
});
