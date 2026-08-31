import { SystemError, SystemErrorCode } from "@repo/core/application/errors";
import { ScopeTaskPriority } from "@repo/core/application/ports/scopeTaskScheduler";
import { describe, expect, it } from "vitest";
import { runDueScopeTasks } from "../../workers/scopeTaskRunner";
import {
  purgeExpiredTrash,
  TRASH_EXPIRY_BATCH_SIZE,
  TRASH_EXPIRY_OPERATION_ID,
  TRASH_EXPIRY_TASK_KIND,
} from "../purgeExpiredTrash";
import { restoreNote } from "../restoreNote";
import { trashNote } from "../trashNote";
import {
  createPersonalNote,
  createTestHarness,
  OWNER,
  storedNote,
  type TestHarness,
  userScope,
} from "./editingHarness";

const DAY_MS = 24 * 60 * 60 * 1000;
const RETENTION_MS = 30 * DAY_MS;

const sweep = (
  h: TestHarness,
  options: Readonly<{
    limit?: number;
    container?: TestHarness["container"];
  }> = {},
) =>
  purgeExpiredTrash({
    container: options.container ?? h.container,
    input: {
      scope: userScope,
      ...(options.limit === undefined ? {} : { limit: options.limit }),
    },
  });

/** Fails the route claim of the notes it matches, so they cannot purge. */
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

async function trashOne(
  h: TestHarness,
): Promise<Readonly<{ noteId: string; purgeAfter: Date }>> {
  const noteId = await createPersonalNote(h);
  const view = await trashNote({
    container: h.container,
    input: { noteId, userId: OWNER, expectedVersion: 0, excludingJobId: null },
  });
  return { noteId, purgeAfter: view.purgeAfter };
}

async function trashNotes(
  h: TestHarness,
  count: number,
): Promise<readonly string[]> {
  const ids: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const noteId = await createPersonalNote(h);
    await trashNote({
      container: h.container,
      input: {
        noteId,
        userId: OWNER,
        expectedVersion: 0,
        excludingJobId: null,
      },
    });
    ids.push(noteId);
  }
  return ids;
}

const tasks = (h: TestHarness) =>
  h.backend.scope(userScope).scheduledTasks.values();

const remainingNotes = (h: TestHarness): number =>
  h.backend.scope(userScope).notes.keys().length;

describe("purgeExpiredTrash", () => {
  it("TC-note-340: purges a note whose retention window lapsed", async () => {
    const h = createTestHarness();
    await trashNotes(h, 1);
    h.clock.advance(31 * DAY_MS);

    const view = await sweep(h);

    expect(view).toEqual({ purgedCount: 1 });
    expect(remainingNotes(h)).toBe(0);
  });

  it("TC-note-341: leaves a note whose retention window is still open", async () => {
    const h = createTestHarness();
    await trashNotes(h, 1);
    h.clock.advance(29 * DAY_MS);

    const view = await sweep(h);

    expect(view).toEqual({ purgedCount: 0 });
    expect(remainingNotes(h)).toBe(1);
  });

  it("TC-note-342: leaves a note one millisecond before its purgeAfter, and takes it on the millisecond", async () => {
    const h = createTestHarness();
    await trashNotes(h, 1);
    h.clock.advance(RETENTION_MS - 1);

    expect(await sweep(h)).toEqual({ purgedCount: 0 });
    expect(remainingNotes(h)).toBe(1);

    h.clock.advance(1);

    expect(await sweep(h)).toEqual({ purgedCount: 1 });
    expect(remainingNotes(h)).toBe(0);
  });

  it("TC-note-343: takes one bounded page and re-arms the scope's own task for the rest", async () => {
    const h = createTestHarness();
    await trashNotes(h, 5);
    h.clock.advance(31 * DAY_MS);

    const view = await sweep(h, { limit: 2 });

    expect(view).toEqual({ purgedCount: 2 });
    expect(remainingNotes(h)).toBe(3);
    expect(tasks(h)).toEqual([
      expect.objectContaining({
        kind: TRASH_EXPIRY_TASK_KIND,
        operationId: TRASH_EXPIRY_OPERATION_ID,
        priority: ScopeTaskPriority.expiryCollection,
        attempt: 0,
      }),
    ]);
  });

  it("TC-note-344: caps an oversized limit at the fan-out budget of one alarm turn", async () => {
    const h = createTestHarness();
    await trashNotes(h, 2);
    h.clock.advance(31 * DAY_MS);
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
                listPurgeable: (now: Date, limit: number) => {
                  limits.push(limit);
                  return ctx.noteRepository.listPurgeable(now, limit);
                },
              },
            }),
          ),
      },
    };

    await sweep(h, { limit: 5000, container });

    expect(limits).toEqual([TRASH_EXPIRY_BATCH_SIZE]);
    expect(TRASH_EXPIRY_BATCH_SIZE).toBe(100);
  });

  it("TC-note-345: records one failure, purges the rest, and keeps the sweep armed", async () => {
    const h = createTestHarness();
    const ids = await trashNotes(h, 3);
    const doomed = ids[1];
    h.clock.advance(31 * DAY_MS);

    const view = await sweep(h, {
      container: withBrokenRouteStore(h, (noteId) => noteId === doomed),
    });

    expect(view).toEqual({ purgedCount: 2 });
    expect(h.backend.scope(userScope).notes.keys()).toEqual([doomed]);
    expect(tasks(h)).toHaveLength(1);
  });

  it("backs the row off instead of re-arming when nothing could be purged", async () => {
    const h = createTestHarness();
    await trashNotes(h, 2);
    h.clock.advance(31 * DAY_MS);

    const view = await sweep(h, { container: withBrokenRouteStore(h) });

    expect(view).toEqual({ purgedCount: 0 });
    expect(remainingNotes(h)).toBe(2);
    expect(tasks(h)).toEqual([
      expect.objectContaining({
        kind: TRASH_EXPIRY_TASK_KIND,
        attempt: 1,
      }),
    ]);
  });

  it("TC-note-346: reports zero and settles the sweep when nothing is due", async () => {
    const h = createTestHarness();
    await trashNotes(h, 1);
    h.clock.advance(31 * DAY_MS);
    await sweep(h);

    const view = await sweep(h);

    expect(view).toEqual({ purgedCount: 0 });
    expect(tasks(h)).toHaveLength(0);
  });

  it("UC-note-021: trashing arms the scope's alarm at the earliest deadline, not the newest one", async () => {
    const h = createTestHarness();
    const first = await trashOne(h);
    h.clock.advance(DAY_MS);
    const second = await trashOne(h);

    expect(second.purgeAfter.getTime()).toBeGreaterThan(
      first.purgeAfter.getTime(),
    );
    expect(tasks(h)).toEqual([
      expect.objectContaining({
        kind: TRASH_EXPIRY_TASK_KIND,
        operationId: TRASH_EXPIRY_OPERATION_ID,
        priority: ScopeTaskPriority.expiryCollection,
        dueAt: first.purgeAfter,
      }),
    ]);
  });

  it("UC-note-021: the runner drives the sweep off that alarm and re-points it at the next deadline", async () => {
    const h = createTestHarness();
    const first = await trashOne(h);
    h.clock.advance(DAY_MS);
    const second = await trashOne(h);

    h.clock.set(first.purgeAfter);
    const firstRound = await runDueScopeTasks(h.workerContainer);

    expect(firstRound.processed).toBe(1);
    expect(h.backend.scope(userScope).notes.keys()).toEqual([second.noteId]);
    expect(tasks(h)).toEqual([
      expect.objectContaining({
        kind: TRASH_EXPIRY_TASK_KIND,
        dueAt: second.purgeAfter,
      }),
    ]);

    h.clock.set(second.purgeAfter);
    const secondRound = await runDueScopeTasks(h.workerContainer);

    expect(secondRound.processed).toBe(1);
    expect(remainingNotes(h)).toBe(0);
    expect(tasks(h)).toHaveLength(0);
    expect(
      h.logger.byLevel("warn").map((entry) => entry.message),
    ).not.toContain(`[scope-tasks] no handler for ${TRASH_EXPIRY_TASK_KIND}`);
  });

  it("UC-note-021: a note still counting down keeps the alarm armed instead of settling it", async () => {
    const h = createTestHarness();
    const first = await trashOne(h);
    h.clock.advance(DAY_MS);
    await trashOne(h);
    h.clock.set(first.purgeAfter);

    const view = await sweep(h);

    expect(view).toEqual({ purgedCount: 1 });
    expect(tasks(h)).toHaveLength(1);
  });

  it("TC-note-350: a note restored between the enumeration and the transaction is left alone", async () => {
    const h = createTestHarness();
    const { noteId, purgeAfter } = await trashOne(h);
    h.clock.set(purgeAfter);
    let restored = false;
    // The window opens after `listPurgeable` and closes when the purge's
    // own transaction re-reads the note, so the restore is driven from
    // the route read the admission makes in between.
    const container: TestHarness["container"] = {
      ...h.container,
      noteRouteStore: {
        ...h.container.noteRouteStore,
        resolve: async (
          id: Parameters<typeof h.container.noteRouteStore.resolve>[0],
        ) => {
          if (!restored) {
            restored = true;
            await restoreNote({
              container: h.container,
              input: { noteId, userId: OWNER, expectedVersion: 1 },
            });
          }
          return h.container.noteRouteStore.resolve(id);
        },
      },
    };

    const view = await sweep(h, { container });

    expect(view).toEqual({ purgedCount: 0 });
    expect(storedNote(h, noteId)?.lifecycle).toBe("active");
  });

  it("does not touch the notes that are still active", async () => {
    const h = createTestHarness();
    const kept = await createPersonalNote(h);
    await trashNotes(h, 1);
    h.clock.advance(31 * DAY_MS);

    const view = await sweep(h);

    expect(view).toEqual({ purgedCount: 1 });
    expect(h.backend.scope(userScope).notes.keys()).toEqual([kept]);
  });
});
