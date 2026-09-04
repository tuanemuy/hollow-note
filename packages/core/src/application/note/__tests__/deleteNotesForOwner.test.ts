import type { NotePurgeContainer } from "@repo/core/application/di/types";
import { SystemError, SystemErrorCode } from "@repo/core/application/errors";
import type { ScopeTaskPayload } from "@repo/core/application/ports/scopeTaskScheduler";
import type { ScopeKey } from "@repo/core/application/scope";
import { UserId } from "@repo/core/domain/identity/valueObject";
import { NoteId } from "@repo/core/domain/note/valueObject";
import { describe, expect, it } from "vitest";
import { runDueScopeTasks } from "../../workers/scopeTaskRunner";
import {
  deleteNotesForOwner,
  NOTE_OWNER_PURGE_TASK_KIND,
  OWNER_PURGE_BATCH_SIZE,
  readOwnerPurgeTurn,
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
    container?: NotePurgeContainer;
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

const acknowledged = (h: TestHarness): Promise<readonly string[] | undefined> =>
  h.container.scopeUnitOfWorkProvider.run(
    userScope,
    async (ctx) =>
      (await ctx.cleanupAdmission.describePersonalCleanup(OPERATION_ID))
        ?.acknowledged,
  );

const tasks = (h: TestHarness, scope: ScopeKey = userScope) =>
  h.backend.scope(scope).scheduledTasks.values();

const remainingNotes = (h: TestHarness, scope: ScopeKey = userScope): number =>
  h.backend.scope(scope).notes.keys().length;

const route = (h: TestHarness, noteId: string) =>
  h.backend.noteRoutes.get(noteId);

/** Claims a note's route for a purge that is not this cleanup's. */
const stopAForeignPurgeOn = (h: TestHarness, noteId: string) =>
  h.container.noteRouteStore.beginPurge({
    noteId: NoteId.create(noteId),
    scope: userScope,
    expectedRouteVersion: route(h, noteId)?.routeVersion ?? 0,
    operationId: "a-user-purge-that-stopped",
  });

/**
 * Loses the response of the `openAt`-th scope transaction, once, after
 * it has committed. Opening the scope three times is one cleanup purge:
 * the enumeration, the purge's `assertOwner`, then the delete itself.
 */
const withLostResponseAfterCommit = (
  h: TestHarness,
  openAt: number,
): TestHarness["container"] => {
  const real = h.container.scopeUnitOfWorkProvider;
  let opened = 0;
  let lost = false;
  return {
    ...h.container,
    scopeUnitOfWorkProvider: {
      run: (async (scope, body) => {
        opened += 1;
        const result = await real.run(scope, body);
        if (opened === openAt && !lost) {
          lost = true;
          throw new SystemError(
            SystemErrorCode.DatabaseError,
            "the commit's response was lost",
          );
        }
        return result;
      }) as typeof real.run,
    },
  };
};

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

    const view = await run(h, { scope: workspaceScope });

    // "Still there" is what a surviving row has to prove, so the note is
    // pinned as an untouched active note rather than merely present —
    // and the workspace note really was purged, which is what makes the
    // survival a scope boundary and not an idle turn.
    expect(view.purgedCount).toBe(1);
    expect(remainingNotes(h, workspaceScope)).toBe(0);
    expect(h.backend.scope(userScope).notes.get(personal)?.lifecycle).toBe(
      "active",
    );
    expect(remainingNotes(h)).toBe(1);
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
    const container = {
      ...h.container,
      scopeUnitOfWorkProvider: {
        run: <T>(
          scope: Parameters<
            typeof h.container.scopeUnitOfWorkProvider.run<T>
          >[0],
          callback: Parameters<
            typeof h.container.scopeUnitOfWorkProvider.run<T>
          >[1],
        ) =>
          h.container.scopeUnitOfWorkProvider.run(scope, (ctx) =>
            callback({
              ...ctx,
              noteRepository: {
                ...ctx.noteRepository,
                listByOwner: (
                  owner: Parameters<typeof ctx.noteRepository.listByOwner>[0],
                  lifecycle: Parameters<
                    typeof ctx.noteRepository.listByOwner
                  >[1],
                  pagination: Parameters<
                    typeof ctx.noteRepository.listByOwner
                  >[2],
                ) => {
                  limits.push(pagination.limit);
                  return ctx.noteRepository.listByOwner(
                    owner,
                    lifecycle,
                    pagination,
                  );
                },
              },
            }),
          ),
      },
    };

    await run(h, { batchSize: 5000, container });

    expect(limits).toEqual([OWNER_PURGE_BATCH_SIZE]);
    // Pinned rather than derived: the value is the global D1 budget of
    // spec/platform/index.md「実行予算と分割単位」divided by the eleven
    // to twelve statements one purge spends there, so a change to it is
    // a change to that section and not a free tuning knob.
    expect(OWNER_PURGE_BATCH_SIZE).toBe(40);
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

  it("TC-note-076: the worker plane claims the continuation it armed and finishes the purge there", async () => {
    const h = createTestHarness();
    await createPersonalNotes(h, 5);
    await beginCleanup(h);

    const first = await deleteNotesForOwner({
      container: h.workerContainer,
      input: {
        deletionOperationId: OPERATION_ID,
        scope: userScope,
        batchSize: 2,
      },
    });
    expect(first.status).toBe("continued");
    expect(remainingNotes(h)).toBe(3);

    const round = await runDueScopeTasks(h.workerContainer);

    expect(round.processed).toBe(1);
    expect(remainingNotes(h)).toBe(0);
    expect(tasks(h)).toHaveLength(0);
    expect(await acknowledged(h)).toContain("note");
    expect(
      h.logger.byLevel("warn").map((entry) => entry.message),
    ).not.toContain(
      `[scope-tasks] no handler for ${NOTE_OWNER_PURGE_TASK_KIND}`,
    );
  });

  it("TC-note-074: the runner's own turns chain until the last note is gone", async () => {
    const h = createTestHarness();
    await createPersonalNotes(h, OWNER_PURGE_BATCH_SIZE + 2);
    await beginCleanup(h);
    await run(h, { batchSize: 1, container: h.workerContainer });

    // Every turn is a claim of the row the previous one re-armed, so the
    // count is the proof the chain is what carried the work: one turn
    // for the first full batch and one for the two notes left over.
    const rounds: number[] = [];
    while (tasks(h).length > 0 && rounds.length < 6) {
      rounds.push((await runDueScopeTasks(h.workerContainer)).processed);
      h.clock.advance(1);
    }

    expect(rounds).toEqual([1, 1]);
    expect(remainingNotes(h)).toBe(0);
  });

  it("TC-note-781: does not read a route another operation holds as a purged note", async () => {
    const h = createTestHarness();
    const [noteId] = await createPersonalNotes(h, 1);
    await beginCleanup(h);
    await stopAForeignPurgeOn(h, noteId);

    const view = await run(h);

    // The rival's claim says nothing about whether this scope's note is
    // gone — and it is not. Counting it would close the deletion's
    // `note` barrier over a note that still holds its body.
    expect(view.purgedCount).toBe(0);
    expect(view.status).not.toBe("settled");
    expect(remainingNotes(h)).toBe(1);
    expect(await acknowledged(h)).not.toContain("note");
    expect(eventsOfType(h, "note.purged")).toHaveLength(0);
  });

  it("TC-note-783: backs the row off once a note it cannot reach is already on the continuation", async () => {
    const h = createTestHarness();
    const [noteId] = await createPersonalNotes(h, 1);
    await beginCleanup(h);
    await stopAForeignPurgeOn(h, noteId);
    await run(h);

    const second = await deleteNotesForOwner({
      container: h.container,
      input: {
        deletionOperationId: OPERATION_ID,
        scope: userScope,
        ...readOwnerPurgeTurn(tasks(h)[0]?.payload ?? {}),
      },
    });

    // Nothing new to hand on, so the turn spends an attempt instead of
    // re-arming: the row climbs towards `failed` and the deletion stays
    // visibly `running` rather than acknowledging a note it never took.
    expect(second.status).toBe("stalled");
    expect(await acknowledged(h)).not.toContain("note");
    expect(tasks(h)).toEqual([
      expect.objectContaining({
        kind: NOTE_OWNER_PURGE_TASK_KIND,
        attempt: 1,
      }),
    ]);
  });

  it("TC-note-782: carries a purge that stopped after the local delete to the next turn, and acknowledges only once it tombstones", async () => {
    const h = createTestHarness();
    const [noteId] = await createPersonalNotes(h, 1);
    await beginCleanup(h);

    const first = await run(h, {
      container: withLostResponseAfterCommit(h, 3),
    });

    // The note row is gone, so no later `listByOwner` can offer it and
    // the closed route hides it from every other enumeration. Only the
    // id the continuation carries can reach it.
    expect(remainingNotes(h)).toBe(0);
    expect(route(h, noteId)?.state).toBe("purging");
    expect(first.status).toBe("continued");
    expect(await acknowledged(h)).not.toContain("note");
    expect(tasks(h)).toEqual([
      expect.objectContaining({
        kind: NOTE_OWNER_PURGE_TASK_KIND,
        payload: {
          deletionOperationId: OPERATION_ID,
          stuckPurges: [{ noteId, expectedVersion: 0 }],
        },
      }),
    ]);

    const round = await runDueScopeTasks(h.workerContainer);

    expect(round.processed).toBe(1);
    expect(route(h, noteId)?.state).toBe("tombstone");
    expect(h.backend.publicPurgeAcks.keys()).toHaveLength(1);
    expect(await acknowledged(h)).toContain("note");
    expect(tasks(h)).toHaveLength(0);
  });

  it("TC-note-782: hands the stuck purge on even when the turn's own settle is lost", async () => {
    const h = createTestHarness();
    const [noteId] = await createPersonalNotes(h, 1);
    await beginCleanup(h);
    const real = h.container.scopeUnitOfWorkProvider;
    let opened = 0;
    const rowsBefore: (readonly ScopeTaskPayload[])[] = [];
    const container: NotePurgeContainer = {
      ...h.container,
      scopeUnitOfWorkProvider: {
        run: (async (scope, body) => {
          opened += 1;
          rowsBefore.push(tasks(h).map((task) => task.payload));
          const result = await real.run(scope, body);
          // The delete's response is lost (3), and so is the
          // transaction that settles the turn (5) — one incident is
          // enough to take both.
          if (opened === 3 || opened === 5) {
            throw new SystemError(
              SystemErrorCode.DatabaseError,
              "the commit's response was lost",
            );
          }
          return result;
        }) as typeof real.run,
      },
    };

    const turn = await run(h, { container }).then(
      () => "the settle committed",
      () => "the settle was lost",
    );

    // What the row held *before* the turn's last transaction: the id was
    // already there. Had it waited for the settle, the loss of that
    // transaction would have left the note recorded nowhere at all.
    expect(rowsBefore.at(-1)).toEqual([
      {
        deletionOperationId: OPERATION_ID,
        stuckPurges: [{ noteId, expectedVersion: 0 }],
      },
    ]);
    expect(turn).toBe("the settle was lost");

    // The note is out of every enumeration, so this row is the only
    // record left of it anywhere.
    expect(remainingNotes(h)).toBe(0);
    expect(route(h, noteId)?.state).toBe("purging");
    expect(tasks(h)).toEqual([
      expect.objectContaining({
        kind: NOTE_OWNER_PURGE_TASK_KIND,
        operationId: OPERATION_ID,
        payload: {
          deletionOperationId: OPERATION_ID,
          stuckPurges: [{ noteId, expectedVersion: 0 }],
        },
      }),
    ]);
    expect(await acknowledged(h)).not.toContain("note");

    const round = await runDueScopeTasks(h.workerContainer);

    expect(round.processed).toBe(1);
    expect(route(h, noteId)?.state).toBe("tombstone");
    expect(await acknowledged(h)).toContain("note");
  });

  it("TC-note-788: keeps the continuation alive for a stuck note even after the listing runs dry", async () => {
    const h = createTestHarness();
    await createPersonalNotes(h, 2);
    await beginCleanup(h);
    await run(h, {
      batchSize: 1,
      container: withLostResponseAfterCommit(h, 3),
    });
    const carried = readOwnerPurgeTurn(tasks(h)[0]?.payload ?? {});
    const stuck = carried.stuckPurges[0]?.noteId ?? "";

    const view = await deleteNotesForOwner({
      // The stuck note stays out of reach while the note the listing
      // does return purges cleanly, so the turn makes progress and
      // still has an exhausted page.
      container: withBrokenRouteStore(h, (noteId) => noteId === stuck),
      input: {
        deletionOperationId: OPERATION_ID,
        scope: userScope,
        ...carried,
      },
    });

    expect(view.purgedCount).toBe(1);
    expect(remainingNotes(h)).toBe(0);
    // An empty listing is not an empty scope: the stuck note is what
    // keeps the component unacknowledged.
    expect(view.status).toBe("continued");
    expect(await acknowledged(h)).not.toContain("note");
    expect(tasks(h)[0]?.payload).toEqual({
      deletionOperationId: OPERATION_ID,
      stuckPurges: [{ noteId: stuck, expectedVersion: 0 }],
    });
  });

  it("TC-note-789: finishing a carried purge does not stand in for a note the listing still holds", async () => {
    const h = createTestHarness();
    await createPersonalNotes(h, 3);
    await beginCleanup(h);
    await run(h, {
      batchSize: 1,
      container: withLostResponseAfterCommit(h, 3),
    });
    const carried = readOwnerPurgeTurn(tasks(h)[0]?.payload ?? {});
    expect(carried.stuckPurges).toHaveLength(1);

    const view = await deleteNotesForOwner({
      container: h.container,
      input: {
        deletionOperationId: OPERATION_ID,
        scope: userScope,
        // Two, because the carried id takes one of the turn's places
        // (TC-note-827): a batch of one would leave the listing none.
        batchSize: 2,
        ...carried,
      },
    });

    // Two purges landed, but only one of them was a row the listing
    // counted — the other had no row left at all. Crediting the page
    // with both would end the walk one note early.
    expect(view.purgedCount).toBe(2);
    expect(view.status).toBe("continued");
    expect(remainingNotes(h)).toBe(1);
    expect(await acknowledged(h)).not.toContain("note");
  });

  it("TC-note-827: the carried purges take their places out of the page, so a turn is never wider than its batch", async () => {
    const h = createTestHarness();
    await createPersonalNotes(h, 4);
    await beginCleanup(h);

    // Two turns that each commit a local delete and lose the response,
    // leaving two notes claimed but not tombstoned. Both are out of
    // every enumeration from here on, which is why the ids have to be
    // carried at all — and why nothing shrinks the list on its own.
    const stuck: { noteId: NoteId; expectedVersion: number }[] = [];
    for (let turn = 0; turn < 2; turn += 1) {
      await run(h, {
        batchSize: 1,
        container: withLostResponseAfterCommit(h, 3),
      });
      const carried = readOwnerPurgeTurn(tasks(h)[0]?.payload ?? {});
      expect(carried.stuckPurges).toHaveLength(1);
      stuck.push(...carried.stuckPurges);
    }
    expect(remainingNotes(h)).toBe(2);

    const view = await deleteNotesForOwner({
      container: h.container,
      input: {
        deletionOperationId: OPERATION_ID,
        scope: userScope,
        batchSize: 2,
        stuckPurges: stuck,
      },
    });

    // The batch is spent entirely on the carried ids, so the listing is
    // read no notes wide and the two rows still standing wait for the
    // next turn. Reading a full page beside the carried ids would make
    // this turn four notes — and an outage that keeps stranding purges
    // would grow that list by a whole batch every turn, with nothing to
    // bound the D1 statements or the continuation payload the turn
    // after that.
    expect(view.purgedCount).toBe(2);
    expect(remainingNotes(h)).toBe(2);
    expect(view.status).toBe("continued");
    expect(await acknowledged(h)).not.toContain("note");
  });

  it("refuses a command from an operation that does not own the scope", async () => {
    const h = createTestHarness();
    await createPersonalNotes(h, 1);
    await beginCleanup(h, userScope, "another-operation");

    await expect(run(h)).rejects.toThrow();
    expect(remainingNotes(h)).toBe(1);
  });
});
