import { UserId } from "@repo/core/domain/identity/valueObject";
import { Note } from "@repo/core/domain/note/note";
import { NoteRevision } from "@repo/core/domain/note/noteRevision";
import { NoteId } from "@repo/core/domain/note/valueObject";
import type { FileDeletedEvent } from "@repo/core/domain/storage/events";
import type { StoredFilePurposeCursor } from "@repo/core/domain/storage/ports/storedFileRepository";
import { StoredFile } from "@repo/core/domain/storage/storedFile";
import {
  Checksum,
  type FilePurpose,
  ObjectKey,
  StorageOwner,
  StoredFileId,
} from "@repo/core/domain/storage/valueObject";
import { WorkspaceId } from "@repo/core/domain/workspace/valueObject";
import { describe, expect, it } from "vitest";
import { createTestHarness, type TestHarness } from "../../__tests__/helpers";
import { createBlankNote } from "../../note/createBlankNote";
import { ScopeTaskPriority } from "../../ports/scopeTaskScheduler";
import { ScopeKey } from "../../scope";
import { runDueScopeTasks } from "../../workers/scopeTaskRunner";
import {
  createWorkspaceHarness,
  seedUser,
} from "../../workspace/__tests__/harness";
import {
  collectOrphanMedia,
  ORPHAN_MEDIA_BATCH_SIZE,
  ORPHAN_MEDIA_MIN_AGE_MS,
  ORPHAN_MEDIA_OPERATION_ID,
  ORPHAN_MEDIA_SWEEP_INTERVAL_MS,
  ORPHAN_MEDIA_TASK_KIND,
  readOrphanMediaSweepTurn,
} from "../collectOrphanMedia";
import { storeMedia } from "../storeMedia";

const OWNER = "user-1";
const userId = UserId.create(OWNER);
const owner = StorageOwner.user(userId);
const scope = ScopeKey.user(userId);
const CHECKSUM = Checksum.sha256("a".repeat(64));
const DAY_MS = 24 * 60 * 60 * 1000;

const objectKeyOf = (id: string, purpose: FilePurpose = "media"): ObjectKey =>
  ObjectKey.build(owner, purpose, StoredFileId.create(id), "png");

/** The address `storeMedia` hands the editor for a stored object. */
const urlOf = (h: TestHarness, id: string): string =>
  h.workerContainer.objectStorage.publicUrl(objectKeyOf(id));

/** Inserts a note snapshot into the scope, with no route: the sweep reads by id. */
async function seedNote(
  h: TestHarness,
  id: string,
  html: string,
  overrides: Partial<Parameters<typeof Note.reconstruct>[0]> = {},
): Promise<NoteId> {
  const now = h.clock.now();
  const note = Note.reconstruct({
    id,
    ownerType: "user",
    ownerId: OWNER,
    createdBy: OWNER,
    title: "Seeded note",
    titleOrigin: "manual",
    contentStatus: "ready",
    html,
    text: "body",
    excerpt: "body",
    headings: [],
    visibilityStatus: "private",
    styleMode: "default",
    lifecycle: "active",
    version: 1,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  });
  await h.container.scopeUnitOfWorkProvider.run(scope, (ctx) =>
    ctx.noteRepository.insert(note),
  );
  return NoteId.create(id);
}

/** Saves one revision of a note — a body `restoreNoteRevision` can put back. */
async function seedRevision(
  h: TestHarness,
  params: Readonly<{ id: string; noteId: NoteId; html: string }>,
): Promise<void> {
  await h.container.scopeUnitOfWorkProvider.run(scope, (ctx) =>
    ctx.noteRevisionRepository.insert(
      NoteRevision.reconstruct({
        id: params.id,
        noteId: params.noteId,
        html: params.html,
        title: "Seeded note",
        titleOrigin: "manual",
        styleMode: "default",
        createdBy: OWNER,
        createdAt: h.clock.now(),
        reason: "manualEdit",
      }),
    ),
  );
}

async function seedFile(
  h: TestHarness,
  params: Readonly<{
    id: string;
    noteId: NoteId;
    ageMs: number;
    purpose?: "source" | "media" | "reference";
    fileOwner?: StorageOwner;
  }>,
): Promise<void> {
  const createdAt = new Date(h.clock.now().getTime() - params.ageMs);
  const purpose = params.purpose ?? "media";
  await h.container.scopeUnitOfWorkProvider.run(scope, (ctx) =>
    ctx.storedFileRepository.insert(
      StoredFile.register(
        {
          id: params.id,
          owner: params.fileOwner ?? owner,
          objectKey: objectKeyOf(params.id, purpose),
          fileName: `${params.id}.png`,
          mimeType: "image/png",
          size: 10,
          checksum: CHECKSUM,
          purpose,
          noteId: params.noteId,
          uploadedBy: userId,
        },
        createdAt,
      ).entity,
    ),
  );
}

const run = (
  h: TestHarness,
  limit?: number,
  cursor: StoredFilePurposeCursor | null = null,
) =>
  collectOrphanMedia({
    container: h.workerContainer,
    input: { scope, cursor, ...(limit === undefined ? {} : { limit }) },
  });

const storedIds = (h: TestHarness): readonly string[] =>
  h.backend
    .scope(scope)
    .storedFiles.values()
    .map((file) => file.id)
    .sort();

const tasks = (h: TestHarness) =>
  h.backend.scope(scope).scheduledTasks.values();

const sweepRow = (h: TestHarness) => {
  const row = tasks(h).find((task) => task.kind === ORPHAN_MEDIA_TASK_KIND);
  if (row === undefined || row.state === "failed") {
    throw new Error("no pending orphan-media sweep row");
  }
  return row;
};

const deletionEvents = (
  h: TestHarness,
): readonly FileDeletedEvent["payload"][] =>
  h.backend.outbox
    .values()
    .filter((row) => row.type === "storage.fileDeleted")
    .map((row) => row.payload as FileDeletedEvent["payload"]);

describe("collectOrphanMedia", () => {
  it("TC-storage-016: collects media aged 31 days that its note's body no longer references", async () => {
    const h = createTestHarness();
    const noteId = await seedNote(h, "note-1", "<p>no picture here</p>");
    await seedFile(h, { id: "file-1", noteId, ageMs: 31 * DAY_MS });

    const view = await run(h);

    expect(view.collectedCount).toBe(1);
    expect(storedIds(h)).toEqual([]);
    expect(deletionEvents(h).map((payload) => payload.fileId)).toEqual([
      "file-1",
    ]);
  });

  it("TC-storage-017: spares media aged 31 days that the body still references, since both conditions must hold", async () => {
    const h = createTestHarness();
    const noteId = await seedNote(
      h,
      "note-1",
      `<p><img src="${urlOf(h, "file-1")}"></p>`,
    );
    await seedFile(h, { id: "file-1", noteId, ageMs: 31 * DAY_MS });

    const view = await run(h);

    expect(view.collectedCount).toBe(0);
    expect(storedIds(h)).toEqual(["file-1"]);
    expect(deletionEvents(h)).toEqual([]);
  });

  it("TC-storage-257: spares media that only a retained revision still references, a restore having to find it there", async () => {
    const h = createTestHarness();
    // "inserted, dropped from the body the next day, swept 29 days
    // later": the age runs from creation, so the file comes due while a
    // revision that shows it is still restorable.
    const noteId = await seedNote(h, "note-1", "<p>the picture went away</p>");
    await seedRevision(h, {
      id: "revision-1",
      noteId,
      html: `<p><img src="${urlOf(h, "file-1")}"></p>`,
    });
    await seedFile(h, { id: "file-1", noteId, ageMs: 31 * DAY_MS });

    const view = await run(h);

    expect(view.collectedCount).toBe(0);
    expect(storedIds(h)).toEqual(["file-1"]);
    expect(deletionEvents(h)).toEqual([]);
  });

  it("TC-storage-016: collects media no revision references either, the history being read as well as the body", async () => {
    const h = createTestHarness();
    const noteId = await seedNote(h, "note-1", "<p>the picture went away</p>");
    await seedRevision(h, {
      id: "revision-1",
      noteId,
      html: `<p><img src="${urlOf(h, "file-2")}"></p>`,
    });
    await seedFile(h, { id: "file-1", noteId, ageMs: 31 * DAY_MS });

    const view = await run(h);

    expect(view.collectedCount).toBe(1);
    expect(storedIds(h)).toEqual([]);
  });

  it("TC-storage-018: spares unreferenced media aged 29 days, the age being measured from creation", async () => {
    const h = createTestHarness();
    const noteId = await seedNote(h, "note-1", "<p>no picture here</p>");
    await seedFile(h, { id: "file-1", noteId, ageMs: 29 * DAY_MS });

    const view = await run(h);

    expect(view.collectedCount).toBe(0);
    expect(storedIds(h)).toEqual(["file-1"]);
  });

  it("TC-storage-019: takes media created exactly 30 days ago, the sweep's starting point being inclusive", async () => {
    const h = createTestHarness();
    const noteId = await seedNote(h, "note-1", "<p>no picture here</p>");
    await seedFile(h, { id: "file-1", noteId, ageMs: ORPHAN_MEDIA_MIN_AGE_MS });
    // One millisecond younger, so the boundary is what separates them.
    await seedFile(h, {
      id: "file-2",
      noteId,
      ageMs: ORPHAN_MEDIA_MIN_AGE_MS - 1,
    });

    const view = await run(h);

    expect(view.collectedCount).toBe(1);
    expect(storedIds(h)).toEqual(["file-2"]);
  });

  it("TC-storage-020: scans the whole scope rather than one owner's files", async () => {
    const h = createTestHarness();
    const noteId = await seedNote(h, "note-1", "<p>no picture here</p>");
    // Stored in this scope but counted against a workspace: a sweep
    // written on `listByOwner` would have to pick an owner, and would
    // never reach this row.
    await seedFile(h, {
      id: "file-1",
      noteId,
      ageMs: 31 * DAY_MS,
      fileOwner: StorageOwner.workspace(WorkspaceId.create("workspace-9")),
    });

    const view = await run(h);

    expect(view.collectedCount).toBe(1);
    expect(storedIds(h)).toEqual([]);
    expect(deletionEvents(h)[0]?.owner).toEqual(
      StorageOwner.workspace(WorkspaceId.create("workspace-9")),
    );
  });

  it("TC-storage-021: resolves the owning note through the file's provenance, reading no other body", async () => {
    const h = createTestHarness();
    const owning = await seedNote(h, "note-1", "<p>no picture here</p>");
    await seedNote(h, "note-2", `<p><img src="${urlOf(h, "file-1")}"></p>`);
    await seedFile(h, { id: "file-1", noteId: owning, ageMs: 31 * DAY_MS });

    const read: string[] = [];
    const view = await collectOrphanMedia({
      container: {
        ...h.workerContainer,
        htmlProcessor: {
          extractExternalReferences: (html) => {
            read.push(html);
            return h.workerContainer.htmlProcessor.extractExternalReferences(
              html,
            );
          },
        },
      },
      input: { scope },
    });

    expect(view.collectedCount).toBe(1);
    // Exactly one body, and it is the owning note's — nothing searched
    // the other note for the URL.
    expect(read).toEqual(["<p>no picture here</p>"]);
  });

  it("TC-storage-022: treats media whose owning note is already gone as collectable", async () => {
    const h = createTestHarness();
    await seedFile(h, {
      id: "file-1",
      noteId: NoteId.create("note-purged"),
      ageMs: 31 * DAY_MS,
    });

    const view = await run(h);

    expect(view.collectedCount).toBe(1);
    expect(storedIds(h)).toEqual([]);
  });

  it("TC-storage-022: spares media whose note has no readable body, an absent body being no evidence the reference was dropped", async () => {
    const h = createTestHarness();
    const noteId = await seedNote(h, "note-1", "<p>no picture here</p>", {
      contentStatus: "processing",
      html: null,
      text: null,
      excerpt: null,
      headings: [],
    });
    await seedFile(h, { id: "file-1", noteId, ageMs: 31 * DAY_MS });

    const view = await run(h);

    expect(view.collectedCount).toBe(0);
    expect(storedIds(h)).toEqual(["file-1"]);
  });

  it("TC-storage-023: collects media another note references, the decision being the owning note's body alone", async () => {
    const h = createTestHarness();
    const owning = await seedNote(h, "note-1", "<p>the picture went away</p>");
    await seedNote(h, "note-2", `<p><img src="${urlOf(h, "file-1")}"></p>`);
    await seedFile(h, { id: "file-1", noteId: owning, ageMs: 31 * DAY_MS });

    const view = await run(h);

    expect(view.collectedCount).toBe(1);
    expect(storedIds(h)).toEqual([]);
  });

  it("TC-storage-024: leaves files of another purpose alone, the scan being limited to media", async () => {
    const h = createTestHarness();
    const noteId = await seedNote(h, "note-1", "<p>no picture here</p>");
    await seedFile(h, {
      id: "file-source",
      noteId,
      ageMs: 31 * DAY_MS,
      purpose: "source",
    });
    await seedFile(h, {
      id: "file-reference",
      noteId,
      ageMs: 31 * DAY_MS,
      purpose: "reference",
    });
    await seedFile(h, { id: "file-media", noteId, ageMs: 31 * DAY_MS });

    const view = await run(h);

    expect(view.collectedCount).toBe(1);
    expect(storedIds(h)).toEqual(["file-reference", "file-source"]);
  });

  it("TC-storage-025: collects only `limit` files in one turn", async () => {
    const h = createTestHarness();
    const noteId = await seedNote(h, "note-1", "<p>no picture here</p>");
    for (const id of ["file-1", "file-2", "file-3"]) {
      await seedFile(h, { id, noteId, ageMs: 31 * DAY_MS });
    }

    const view = await run(h, 2);

    expect(view.collectedCount).toBe(2);
    expect(storedIds(h)).toHaveLength(1);
  });

  it("TC-storage-026: arms the scope's daily sweep when the first media is stored, and leaves it where it is afterwards", async () => {
    const h = createWorkspaceHarness();
    seedUser(h, { userId: OWNER });
    const { noteId } = await createBlankNote({
      container: h.container,
      input: { userId: OWNER, ownerType: "user" },
    });
    const png = new Uint8Array(32);
    png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);

    const armedAt = h.clock.now();
    await storeMedia({
      container: h.container,
      input: { userId: OWNER, noteId, fileName: "first.png", body: png },
    });

    expect(
      tasks(h).map((task) => ({
        kind: task.kind,
        operationId: task.operationId,
        dueAt: task.state === "failed" ? null : task.dueAt,
      })),
    ).toEqual([
      {
        kind: ORPHAN_MEDIA_TASK_KIND,
        operationId: ORPHAN_MEDIA_OPERATION_ID,
        dueAt: new Date(armedAt.getTime() + ORPHAN_MEDIA_SWEEP_INTERVAL_MS),
      },
    ]);

    // A second insertion a day later must not push the sweep it is
    // waiting for out of reach.
    h.clock.advance(DAY_MS);
    await storeMedia({
      container: h.container,
      input: { userId: OWNER, noteId, fileName: "second.png", body: png },
    });

    expect(sweepRow(h).dueAt).toEqual(
      new Date(armedAt.getTime() + ORPHAN_MEDIA_SWEEP_INTERVAL_MS),
    );
  });

  it("TC-storage-027: re-arms for immediately after while the listing has a page left, then falls back to the next day", async () => {
    const h = createTestHarness();
    const noteId = await seedNote(h, "note-1", "<p>no picture here</p>");
    for (const id of ["file-1", "file-2", "file-3"]) {
      await seedFile(h, { id, noteId, ageMs: 31 * DAY_MS });
    }
    const now = h.clock.now();

    const first = await run(h, 2);

    expect(first.collectedCount).toBe(2);
    expect(first.nextCursor?.id).toBe("file-2");
    expect(sweepRow(h).dueAt).toEqual(now);

    const second = await run(h, 2, first.nextCursor);

    expect(second.collectedCount).toBe(1);
    expect(second.nextCursor).toBeNull();
    expect(sweepRow(h).dueAt).toEqual(
      new Date(now.getTime() + ORPHAN_MEDIA_SWEEP_INTERVAL_MS),
    );
    // One row throughout: the sweep is keyed by `(kind, operationId)`.
    expect(tasks(h)).toHaveLength(1);
  });

  it("TC-storage-254: a full page of files the bodies still reference is continued past, and the walk stops at the next day once nothing is behind it", async () => {
    const h = createTestHarness();
    const noteId = await seedNote(
      h,
      "note-1",
      `<p><img src="${urlOf(h, "file-1")}"><img src="${urlOf(h, "file-2")}"></p>`,
    );
    for (const id of ["file-1", "file-2"]) {
      await seedFile(h, { id, noteId, ageMs: 31 * DAY_MS });
    }
    const now = h.clock.now();

    const first = await run(h, 2);

    // Nothing was collected, but the page was full, so the listing —
    // not the harvest — is what says there may be more behind it.
    expect(first.collectedCount).toBe(0);
    expect(first.nextCursor?.id).toBe("file-2");
    expect(sweepRow(h).dueAt).toEqual(now);

    const second = await run(h, 2, first.nextCursor);

    // Behind the spared page there is nothing, so the chain of
    // immediate turns ends here instead of spinning on the same page.
    expect(second.collectedCount).toBe(0);
    expect(second.nextCursor).toBeNull();
    expect(sweepRow(h).dueAt).toEqual(
      new Date(now.getTime() + ORPHAN_MEDIA_SWEEP_INTERVAL_MS),
    );
    expect(storedIds(h)).toEqual(["file-1", "file-2"]);
  });

  it("TC-storage-254: collects an orphan sitting behind a full page of files the bodies still reference, driven from the worker plane", async () => {
    const h = createTestHarness();
    const referenced = Array.from(
      { length: ORPHAN_MEDIA_BATCH_SIZE },
      (_, n) =>
        // Padded so the id order matches the seeding order: the whole
        // batch shares one creation instant, and `id` breaks that tie.
        `file-${String(n).padStart(3, "0")}`,
    );
    const noteId = await seedNote(
      h,
      "note-1",
      `<p>${referenced.map((id) => `<img src="${urlOf(h, id)}">`).join("")}</p>`,
    );
    for (const id of referenced) {
      await seedFile(h, { id, noteId, ageMs: 0 });
    }
    // Sorts last, so a sweep pinned to the head of the listing never
    // reaches it: the first page is a full batch of referenced rows.
    await seedFile(h, { id: "file-100", noteId, ageMs: 0 });
    await h.container.scopeUnitOfWorkProvider.run(scope, (ctx) =>
      ctx.scopeTaskScheduler.schedule({
        kind: ORPHAN_MEDIA_TASK_KIND,
        operationId: ORPHAN_MEDIA_OPERATION_ID,
        priority: ScopeTaskPriority.expiryCollection,
        dueAt: new Date(
          h.clock.now().getTime() + ORPHAN_MEDIA_SWEEP_INTERVAL_MS,
        ),
        payload: {},
      }),
    );
    h.clock.advance(31 * DAY_MS);

    const first = await runDueScopeTasks(h.workerContainer);
    expect(first.processed).toBe(1);
    // Every row of the first page is still referenced, so nothing goes;
    // the row is nonetheless due again at once, carrying its position.
    expect(storedIds(h)).toHaveLength(ORPHAN_MEDIA_BATCH_SIZE + 1);
    expect(sweepRow(h).dueAt).toEqual(h.clock.now());
    expect(sweepRow(h).payload.afterId).toBe("file-099");

    const second = await runDueScopeTasks(h.workerContainer);
    expect(second.processed).toBe(1);
    expect(storedIds(h)).toEqual(referenced);
    expect(deletionEvents(h).map((payload) => payload.fileId)).toEqual([
      "file-100",
    ]);
    expect(sweepRow(h).dueAt).toEqual(
      new Date(h.clock.now().getTime() + ORPHAN_MEDIA_SWEEP_INTERVAL_MS),
    );
    expect(sweepRow(h).payload.afterId).toBeUndefined();

    // Back to the daily cadence: nothing is due any more.
    expect((await runDueScopeTasks(h.workerContainer)).processed).toBe(0);
  });

  it("TC-storage-255: starts a fresh pass from the head when the payload carries no readable position", async () => {
    expect(readOrphanMediaSweepTurn({}).cursor).toBeNull();
    expect(
      readOrphanMediaSweepTurn({ afterCreatedAt: "not a date", afterId: "f" })
        .cursor,
    ).toBeNull();
    expect(
      readOrphanMediaSweepTurn({ afterCreatedAt: 12, afterId: "f" }).cursor,
    ).toBeNull();
    expect(
      readOrphanMediaSweepTurn({
        afterCreatedAt: new Date(0).toISOString(),
        afterId: "   ",
      }).cursor,
    ).toBeNull();
    expect(
      readOrphanMediaSweepTurn({
        afterCreatedAt: new Date(1_000).toISOString(),
        afterId: "file-1",
      }).cursor,
    ).toEqual({ createdAt: new Date(1_000), id: "file-1" });
  });

  it("TC-storage-027: is resumed by the scope-task runner until the scope is swept clean", async () => {
    const h = createTestHarness();
    // Armed while the scope holds no media at all, which is the only
    // moment `storeMedia` arms it in production.
    await h.container.scopeUnitOfWorkProvider.run(scope, (ctx) =>
      ctx.scopeTaskScheduler.schedule({
        kind: ORPHAN_MEDIA_TASK_KIND,
        operationId: ORPHAN_MEDIA_OPERATION_ID,
        priority: ScopeTaskPriority.expiryCollection,
        dueAt: new Date(
          h.clock.now().getTime() + ORPHAN_MEDIA_SWEEP_INTERVAL_MS,
        ),
        payload: {},
      }),
    );
    const noteId = await seedNote(h, "note-1", "<p>no picture here</p>");
    for (let n = 0; n <= 100; n += 1) {
      await seedFile(h, {
        id: `file-${String(n).padStart(3, "0")}`,
        noteId,
        ageMs: 0,
      });
    }
    h.clock.advance(31 * DAY_MS);

    const first = await runDueScopeTasks(h.workerContainer);
    expect(first.processed).toBe(1);
    expect(storedIds(h)).toHaveLength(1);

    const second = await runDueScopeTasks(h.workerContainer);
    expect(second.processed).toBe(1);
    expect(storedIds(h)).toEqual([]);

    // Nothing is due any more: the sweep put itself a day out.
    const third = await runDueScopeTasks(h.workerContainer);
    expect(third.processed).toBe(0);
    expect(sweepRow(h).dueAt).toEqual(
      new Date(h.clock.now().getTime() + ORPHAN_MEDIA_SWEEP_INTERVAL_MS),
    );
    expect(
      h.logger.byLevel("warn").map((entry) => entry.message),
    ).not.toContain(
      `[scope-tasks] no handler for ${ORPHAN_MEDIA_TASK_KIND}; leaving it due`,
    );
  });

  it("TC-storage-028: records a file it could not remove and carries on with the rest", async () => {
    const h = createTestHarness();
    const noteId = await seedNote(h, "note-1", "<p>no picture here</p>");
    await seedFile(h, { id: "file-1", noteId, ageMs: 40 * DAY_MS });
    await seedFile(h, { id: "file-2", noteId, ageMs: 31 * DAY_MS });

    // The scan is the first transaction; the second is the first
    // deletion, and it is the one that fails.
    const real = h.workerContainer.scopeUnitOfWorkProvider;
    let opened = 0;
    const view = await collectOrphanMedia({
      container: {
        ...h.workerContainer,
        scopeUnitOfWorkProvider: {
          run: async (target, fn) => {
            opened += 1;
            if (opened === 2) {
              throw new Error("the row would not go");
            }
            return real.run(target, fn);
          },
        },
      },
      input: { scope },
    });

    expect(view.collectedCount).toBe(1);
    expect(storedIds(h)).toEqual(["file-1"]);
    expect(h.logger.byLevel("error").map((entry) => entry.message)).toContain(
      "[collectOrphanMedia] a file was left behind",
    );
  });

  it("TC-storage-258: re-arms for the next day when the whole turn fails, so the scope's only sweep row cannot park", async () => {
    const h = createTestHarness();
    const now = h.clock.now();
    const real = h.workerContainer.scopeUnitOfWorkProvider;
    let opened = 0;

    const view = await collectOrphanMedia({
      container: {
        ...h.workerContainer,
        scopeUnitOfWorkProvider: {
          run: async (target, fn) => {
            opened += 1;
            if (opened === 1) {
              throw new Error("the listing would not read");
            }
            return real.run(target, fn);
          },
        },
      },
      input: { scope },
    });

    expect(view).toEqual({ collectedCount: 0, nextCursor: null });
    // Nothing else re-arms this row: `armOrphanMediaSweepOnFirstMedia`
    // only fires while the scope holds no media at all. Letting the turn
    // throw walks it to the attempt ceiling and parks it as `failed`.
    expect(sweepRow(h).dueAt).toEqual(
      new Date(now.getTime() + ORPHAN_MEDIA_SWEEP_INTERVAL_MS),
    );
    expect(h.logger.byLevel("error").map((entry) => entry.message)).toContain(
      "[collectOrphanMedia] the turn failed; re-armed for the next day",
    );
  });

  it("TC-storage-028: spares a candidate whose body it cannot read and finishes the rest of the page", async () => {
    const h = createTestHarness();
    const unreadable = await seedNote(h, "note-1", "<p>unreadable body</p>");
    const readable = await seedNote(h, "note-2", "<p>no picture here</p>");
    await seedFile(h, { id: "file-1", noteId: unreadable, ageMs: 31 * DAY_MS });
    await seedFile(h, { id: "file-2", noteId: readable, ageMs: 31 * DAY_MS });

    const view = await collectOrphanMedia({
      container: {
        ...h.workerContainer,
        htmlProcessor: {
          extractExternalReferences: (html) => {
            if (html === "<p>unreadable body</p>") {
              throw new Error("the body would not parse");
            }
            return h.workerContainer.htmlProcessor.extractExternalReferences(
              html,
            );
          },
        },
      },
      input: { scope },
    });

    // Losing the turn instead would stall the cursor on this page and
    // hide every row behind it for as long as the body stays poisoned.
    expect(view.collectedCount).toBe(1);
    expect(storedIds(h)).toEqual(["file-1"]);
    expect(h.logger.byLevel("error").map((entry) => entry.message)).toContain(
      "[collectOrphanMedia] a file could not be judged",
    );
  });

  it("TC-storage-029: answers zero when the scope holds nothing old enough, and waits for the next day", async () => {
    const h = createTestHarness();
    const now = h.clock.now();

    const view = await run(h);

    expect(view.collectedCount).toBe(0);
    expect(sweepRow(h).dueAt).toEqual(
      new Date(now.getTime() + ORPHAN_MEDIA_SWEEP_INTERVAL_MS),
    );
  });
});
