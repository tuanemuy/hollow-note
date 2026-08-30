import { SystemError, SystemErrorCode } from "@repo/core/application/errors";
import type { ScopeKey } from "@repo/core/application/scope";
import { BusinessRuleError } from "@repo/core/domain/error";
import { UserId } from "@repo/core/domain/identity/valueObject";
import { Note } from "@repo/core/domain/note/note";
import { NoteOwner } from "@repo/core/domain/note/valueObject";
import { WorkspaceErrorCode } from "@repo/core/domain/workspace/errorCode";
import { WorkspaceId } from "@repo/core/domain/workspace/valueObject";
import { describe, expect, it } from "vitest";
import {
  EMPTY_TRASH_JOB_CHUNK_SIZE,
  EMPTY_TRASH_SYNCHRONOUS_LIMIT,
  emptyTrash,
  type NoteBulkPurgeJobs,
} from "../emptyTrash";
import type { NoteJobScope } from "../jobs";
import { purgeNote } from "../purgeNote";
import { restoreNote } from "../restoreNote";
import { trashNote } from "../trashNote";
import {
  createPersonalNote,
  createTestHarness,
  createWorkspaceNote,
  OWNER,
  seedWorkspace,
  type TestHarness,
  userScope,
  VIEWER,
  WORKSPACE,
  workspaceScope,
} from "./editingHarness";

const DAY_MS = 24 * 60 * 60 * 1000;

type RecordedChunk = Readonly<{
  noteIds: readonly string[];
  scope: NoteJobScope;
  requestedBy: string;
}>;

type RecordingBulkPurgeJobs = NoteBulkPurgeJobs &
  Readonly<{ chunks: RecordedChunk[] }>;

/**
 * Stand-in for the bulk-operation half of the job path. The Job
 * aggregate belongs to a later slice, so `NoteBulkPurgeJobs` has no
 * adapter — this records what the usecase enrolled and answers with an
 * id per chunk.
 */
function recordingBulkPurgeJobs(): RecordingBulkPurgeJobs {
  const chunks: RecordedChunk[] = [];
  return {
    chunks,
    async requestBulkPurge(_container, params): Promise<string | null> {
      chunks.push({
        noteIds: params.noteIds,
        scope: params.scope,
        requestedBy: params.requestedBy,
      });
      return `job-${chunks.length}`;
    },
  };
}

const empty = (
  h: TestHarness,
  jobs: NoteBulkPurgeJobs,
  input: Readonly<{ userId?: string; workspaceId?: string }> = {},
) =>
  emptyTrash({
    container: h.container,
    input:
      input.workspaceId === undefined
        ? { userId: input.userId ?? OWNER }
        : {
            userId: input.userId ?? OWNER,
            ownerType: "workspace",
            ownerWorkspaceId: input.workspaceId,
          },
    jobs,
  });

/** Creates real notes through the usecases and moves them to the trash. */
async function trashPersonalNotes(
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

/**
 * Writes trashed rows straight into the scope's table. The job path
 * never purges, so these notes need no route — and enrolling 1200 of
 * them through `createBlankNote` would only make the case slower, not
 * more faithful.
 */
function seedTrashedNotes(
  h: TestHarness,
  count: number,
  scope: ScopeKey = userScope,
  owner: NoteOwner = NoteOwner.user(UserId.create(OWNER)),
): void {
  const now = h.clock.now();
  const store = h.backend.scope(scope).notes;
  for (let i = 0; i < count; i += 1) {
    const id = `seeded-${String(i).padStart(4, "0")}`;
    store.set(
      id,
      Note.reconstruct({
        id,
        ownerType: owner.type,
        ownerId: owner.type === "user" ? owner.userId : owner.workspaceId,
        createdBy: OWNER,
        title: "無題",
        titleOrigin: "auto",
        contentStatus: "ready",
        html: "<p></p>",
        text: "",
        excerpt: "",
        headings: [],
        visibilityStatus: "private",
        styleMode: "default",
        lifecycle: "trashed",
        trashedAt: now,
        purgeAfter: new Date(now.getTime() + 30 * DAY_MS),
        version: 1,
        createdAt: now,
        updatedAt: new Date(now.getTime() + i),
      }),
    );
  }
}

const trashedCount = (
  h: TestHarness,
  scope: ScopeKey = userScope,
  owner: NoteOwner = NoteOwner.user(UserId.create(OWNER)),
): Promise<number> =>
  h.container.noteReaderFor(scope).countByOwner(owner, "trashed");

describe("emptyTrash", () => {
  it("TC-note-098: purges every note in the trash and reports the count", async () => {
    const h = createTestHarness();
    await trashPersonalNotes(h, 10);

    const view = await empty(h, recordingBulkPurgeJobs());

    expect(view).toEqual({ mode: "purged", purgedCount: 10, jobIds: [] });
    expect(h.backend.scope(userScope).notes.keys()).toHaveLength(0);
  });

  it("TC-note-099: leaves the active notes of the same owner untouched", async () => {
    const h = createTestHarness();
    await trashPersonalNotes(h, 10);
    const active: string[] = [];
    for (let i = 0; i < 30; i += 1) {
      active.push(await createPersonalNote(h));
    }

    const view = await empty(h, recordingBulkPurgeJobs());

    expect(view.purgedCount).toBe(10);
    expect([...h.backend.scope(userScope).notes.keys()].sort()).toEqual(
      [...active].sort(),
    );
  });

  it("TC-note-100: answers an empty trash with a zero count", async () => {
    const h = createTestHarness();

    const view = await empty(h, recordingBulkPurgeJobs());

    expect(view).toEqual({ mode: "purged", purgedCount: 0, jobIds: [] });
  });

  it("TC-note-101: purges inline at the synchronous boundary of 50", async () => {
    const h = createTestHarness();
    await trashPersonalNotes(h, EMPTY_TRASH_SYNCHRONOUS_LIMIT);
    const jobs = recordingBulkPurgeJobs();

    const view = await empty(h, jobs);

    expect(view).toEqual({ mode: "purged", purgedCount: 50, jobIds: [] });
    expect(jobs.chunks).toHaveLength(0);
    expect(await trashedCount(h)).toBe(0);
  });

  it("TC-note-102: registers one bulk job at 51, the first size past the boundary", async () => {
    const h = createTestHarness();
    seedTrashedNotes(h, 51);
    const jobs = recordingBulkPurgeJobs();

    const view = await empty(h, jobs);

    expect(view.mode).toBe("scheduled");
    expect(view.purgedCount).toBe(51);
    expect(view.jobIds).toEqual(["job-1"]);
    expect(jobs.chunks.map((chunk) => chunk.noteIds.length)).toEqual([51]);
  });

  it("TC-note-103: splits 501 notes into two jobs at the 500-note chunk", async () => {
    const h = createTestHarness();
    seedTrashedNotes(h, EMPTY_TRASH_JOB_CHUNK_SIZE + 1);
    const jobs = recordingBulkPurgeJobs();

    const view = await empty(h, jobs);

    expect(view.jobIds).toHaveLength(2);
    expect(jobs.chunks.map((chunk) => chunk.noteIds.length)).toEqual([500, 1]);
  });

  it("TC-note-104: has deleted nothing by the time the scheduled response returns", async () => {
    const h = createTestHarness();
    seedTrashedNotes(h, 51);

    const view = await empty(h, recordingBulkPurgeJobs());

    expect(view.mode).toBe("scheduled");
    expect(await trashedCount(h)).toBe(51);
  });

  it("TC-note-106: splits 1200 notes into 500 / 500 / 200", async () => {
    const h = createTestHarness();
    seedTrashedNotes(h, 1200);
    const jobs = recordingBulkPurgeJobs();

    const view = await empty(h, jobs);

    expect(view.mode).toBe("scheduled");
    expect(view.purgedCount).toBe(1200);
    expect(view.jobIds).toEqual(["job-1", "job-2", "job-3"]);
    expect(jobs.chunks.map((chunk) => chunk.noteIds.length)).toEqual([
      500, 500, 200,
    ]);
    expect(
      new Set(jobs.chunks.flatMap((chunk) => [...chunk.noteIds])).size,
    ).toBe(1200);
  });

  it("TC-note-107: gives every split the source scope of the trash it came from", async () => {
    const h = createTestHarness();
    await seedWorkspace(h, [{ userId: OWNER, role: "owner" }]);
    seedTrashedNotes(
      h,
      501,
      workspaceScope,
      NoteOwner.workspace(WorkspaceId.create(WORKSPACE)),
    );
    const jobs = recordingBulkPurgeJobs();

    await empty(h, jobs, { workspaceId: WORKSPACE });

    expect(jobs.chunks).toHaveLength(2);
    for (const chunk of jobs.chunks) {
      expect(chunk.scope).toEqual({
        type: "workspace",
        workspaceId: WORKSPACE,
      });
      expect(chunk.requestedBy).toBe(OWNER);
    }
  });

  it("TC-note-108: refuses a workspace viewer", async () => {
    const h = createTestHarness();
    await seedWorkspace(h, [
      { userId: OWNER, role: "owner" },
      { userId: VIEWER, role: "viewer" },
    ]);
    const noteId = await createWorkspaceNote(h);
    await trashNote({
      container: h.container,
      input: {
        noteId,
        userId: OWNER,
        expectedVersion: 0,
        excludingJobId: null,
      },
    });

    await expect(
      empty(h, recordingBulkPurgeJobs(), {
        userId: VIEWER,
        workspaceId: WORKSPACE,
      }),
    ).rejects.toMatchObject({
      code: WorkspaceErrorCode.InsufficientRole,
    });
    expect(
      await trashedCount(
        h,
        workspaceScope,
        NoteOwner.workspace(WorkspaceId.create(WORKSPACE)),
      ),
    ).toBe(1);
  });

  it("TC-note-109: lets a workspace editor empty the trash", async () => {
    const h = createTestHarness();
    await seedWorkspace(h, [
      { userId: OWNER, role: "owner" },
      { userId: "user-editor", role: "editor" },
    ]);
    const noteId = await createWorkspaceNote(h);
    await trashNote({
      container: h.container,
      input: {
        noteId,
        userId: OWNER,
        expectedVersion: 0,
        excludingJobId: null,
      },
    });

    const view = await empty(h, recordingBulkPurgeJobs(), {
      userId: "user-editor",
      workspaceId: WORKSPACE,
    });

    expect(view).toEqual({ mode: "purged", purgedCount: 1, jobIds: [] });
  });

  it("TC-note-110: empties only the context it was asked for", async () => {
    const h = createTestHarness();
    await seedWorkspace(h, [{ userId: OWNER, role: "owner" }]);
    await trashPersonalNotes(h, 2);
    const workspaceNote = await createWorkspaceNote(h);
    await trashNote({
      container: h.container,
      input: {
        noteId: workspaceNote,
        userId: OWNER,
        expectedVersion: 0,
        excludingJobId: null,
      },
    });

    const view = await empty(h, recordingBulkPurgeJobs());

    expect(view.purgedCount).toBe(2);
    expect(
      await trashedCount(
        h,
        workspaceScope,
        NoteOwner.workspace(WorkspaceId.create(WORKSPACE)),
      ),
    ).toBe(1);
  });

  it("TC-note-111: keeps going when one note cannot be purged, and does not count it", async () => {
    const h = createTestHarness();
    const ids = await trashPersonalNotes(h, 3);
    const doomed = ids[1];
    const container = {
      ...h.container,
      noteRouteStore: {
        ...h.container.noteRouteStore,
        beginPurge: async (
          params: Parameters<typeof h.container.noteRouteStore.beginPurge>[0],
        ) => {
          if (params.noteId === doomed) {
            throw new SystemError(
              SystemErrorCode.DatabaseError,
              "route store unavailable",
            );
          }
          return h.container.noteRouteStore.beginPurge(params);
        },
      },
    };

    const view = await emptyTrash({
      container,
      input: { userId: OWNER },
      jobs: recordingBulkPurgeJobs(),
    });

    expect(view.purgedCount).toBe(2);
    expect(h.backend.scope(userScope).notes.keys()).toEqual([doomed]);
  });

  it("TC-note-112: composes purgeNote and opens no unit of work of its own", async () => {
    const h = createTestHarness();
    await trashPersonalNotes(h, 4);
    let runs = 0;
    const container = {
      ...h.container,
      scopeUnitOfWorkProvider: {
        run: <T>(
          scope: ScopeKey,
          callback: Parameters<
            typeof h.container.scopeUnitOfWorkProvider.run<T>
          >[1],
        ) => {
          runs += 1;
          return h.container.scopeUnitOfWorkProvider.run(scope, callback);
        },
      },
    };

    const view = await emptyTrash({
      container,
      input: { userId: OWNER },
      jobs: recordingBulkPurgeJobs(),
    });

    // One transaction per purge and not one more: a loop wrapped in its
    // own unit of work would show five.
    expect(view.purgedCount).toBe(4);
    expect(runs).toBe(4);
  });

  it("TC-note-113: skips a note restored between the enumeration and its purge", async () => {
    const h = createTestHarness();
    await trashPersonalNotes(h, 2);
    const listed = await h.container
      .noteReaderFor(userScope)
      .listByOwner(NoteOwner.user(UserId.create(OWNER)), "trashed", {
        page: 1,
        limit: 50,
      });
    const rescued = listed.items[1].id;

    let armed = true;
    const container = {
      ...h.container,
      noteRouteStore: {
        ...h.container.noteRouteStore,
        beginPurge: async (
          params: Parameters<typeof h.container.noteRouteStore.beginPurge>[0],
        ) => {
          if (armed) {
            armed = false;
            await restoreNote({
              container: h.container,
              input: { noteId: rescued, userId: OWNER, expectedVersion: 1 },
            });
          }
          return h.container.noteRouteStore.beginPurge(params);
        },
      },
    };

    const view = await emptyTrash({
      container,
      input: { userId: OWNER },
      jobs: recordingBulkPurgeJobs(),
    });

    expect(view.purgedCount).toBe(1);
    const survivor = h.backend.scope(userScope).notes.get(rescued);
    expect(survivor?.lifecycle).toBe("active");
  });

  it("TC-note-114: skips a note another path had already purged", async () => {
    const h = createTestHarness();
    await trashPersonalNotes(h, 2);
    const listed = await h.container
      .noteReaderFor(userScope)
      .listByOwner(NoteOwner.user(UserId.create(OWNER)), "trashed", {
        page: 1,
        limit: 50,
      });
    const stolen = listed.items[1].id;

    let armed = true;
    const container = {
      ...h.container,
      noteRouteStore: {
        ...h.container.noteRouteStore,
        beginPurge: async (
          params: Parameters<typeof h.container.noteRouteStore.beginPurge>[0],
        ) => {
          if (armed) {
            armed = false;
            await purgeNote({
              container: h.container,
              input: {
                kind: "userRequest",
                noteId: stolen,
                userId: OWNER,
                expectedVersion: 1,
              },
            });
          }
          return h.container.noteRouteStore.beginPurge(params);
        },
      },
    };

    const view = await emptyTrash({
      container,
      input: { userId: OWNER },
      jobs: recordingBulkPurgeJobs(),
    });

    expect(view.purgedCount).toBe(1);
    expect(h.backend.scope(userScope).notes.keys()).toHaveLength(0);
  });

  it("TC-note-115: reads the inline path's targets in a single page", async () => {
    const h = createTestHarness();
    await trashPersonalNotes(h, EMPTY_TRASH_SYNCHRONOUS_LIMIT);
    const limits: number[] = [];
    const reader = h.container.noteReaderFor(userScope);
    const container = {
      ...h.container,
      noteReaderFor: () => ({
        ...reader,
        listByOwner: (
          owner: NoteOwner,
          lifecycle: "active" | "trashed" | "all",
          pagination: Readonly<{ page: number; limit: number }>,
        ) => {
          limits.push(pagination.limit);
          return reader.listByOwner(owner, lifecycle, pagination);
        },
      }),
    };

    const view = await emptyTrash({
      container,
      input: { userId: OWNER },
      jobs: recordingBulkPurgeJobs(),
    });

    expect(view.purgedCount).toBe(50);
    expect(limits).toEqual([EMPTY_TRASH_SYNCHRONOUS_LIMIT]);
    expect(EMPTY_TRASH_SYNCHRONOUS_LIMIT).toBeLessThanOrEqual(100);
  });

  it("rejects a non-member asking for a workspace trash", async () => {
    const h = createTestHarness();
    await seedWorkspace(h, [{ userId: OWNER, role: "owner" }]);

    await expect(
      empty(h, recordingBulkPurgeJobs(), {
        userId: "user-outsider",
        workspaceId: WORKSPACE,
      }),
    ).rejects.toBeInstanceOf(BusinessRuleError);
  });
});
