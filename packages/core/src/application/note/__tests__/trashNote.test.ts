import {
  isConflictError,
  isNotFoundError,
} from "@repo/core/application/errors";
import { noteAccessPolicy } from "@repo/core/application/note/accessControl";
import { ScopeTaskPriority } from "@repo/core/application/ports/scopeTaskScheduler";
import { Version } from "@repo/core/domain/common/version";
import { type TokenHash, UserId } from "@repo/core/domain/identity/valueObject";
import { NoteId, NoteOwner } from "@repo/core/domain/note/valueObject";
import type { EphemeralFile } from "@repo/core/domain/storage/storedFile";
import {
  ByteSize,
  Checksum,
  FileName,
  MimeType,
  ObjectKey,
  StorageOwner,
  StoredFileId,
} from "@repo/core/domain/storage/valueObject";
import { describe, expect, it } from "vitest";
import { getNote } from "../getNote";
import type { ActiveNoteJob } from "../jobs";
import { listNotes } from "../listNotes";
import {
  TRASH_EXPIRY_OPERATION_ID,
  TRASH_EXPIRY_TASK_KIND,
} from "../purgeExpiredTrash";
import { renameNote } from "../renameNote";
import { restoreNote } from "../restoreNote";
import { JOB_TERMINATION_CONTINUATION_KIND, trashNote } from "../trashNote";
import {
  createPersonalNote,
  createTestHarness,
  createWorkspaceNote,
  eventsOfType,
  OWNER,
  outboxTypes,
  type RecordingTrashJobs,
  recordingTrashJobs,
  reseedNote,
  SHARE_TOKEN_HASH,
  scheduledTasks,
  seedWorkspace,
  storedNote,
  type TestHarness,
  userScope,
  VIEWER,
  workspaceScope,
} from "./editingHarness";

const DAY_MS = 24 * 60 * 60 * 1000;

const trash = (
  h: TestHarness,
  noteId: string,
  options: Readonly<{
    expectedVersion?: number;
    userId?: string;
    excludingJobId?: string | null;
    jobs?: RecordingTrashJobs;
  }> = {},
) =>
  trashNote({
    container: h.container,
    input: {
      noteId,
      userId: options.userId ?? OWNER,
      expectedVersion: options.expectedVersion ?? 0,
      excludingJobId: options.excludingJobId ?? null,
    },
    ...(options.jobs !== undefined ? { jobs: options.jobs } : {}),
  });

const job = (jobId: string, kind: string): ActiveNoteJob => ({ jobId, kind });

const anonymousAccess = (h: TestHarness, noteId: string): string => {
  const note = storedNote(h, noteId);
  if (note === null) {
    throw new Error(`note ${noteId} is not seeded`);
  }
  return noteAccessPolicy.evaluate(
    note,
    { kind: "anonymous" },
    { tokenHash: SHARE_TOKEN_HASH as TokenHash, pass: null },
    h.clock.now(),
  ).kind;
};

/** A succeeded export's artifact, seeded straight into the scope table. */
const seedArtifact = (h: TestHarness, noteId: string): EphemeralFile => {
  const now = h.clock.now();
  const file: EphemeralFile = {
    id: StoredFileId.create("file-artifact"),
    owner: StorageOwner.user(UserId.create(OWNER)),
    objectKey: ObjectKey.create("users/user-owner/artifact/file-artifact.pdf"),
    fileName: FileName.create("note.pdf"),
    mimeType: MimeType.create("application/pdf"),
    size: ByteSize.create(1024),
    checksum: Checksum.sha256("a".repeat(64)),
    version: Version.initial(),
    createdAt: now,
    updatedAt: now,
    retention: "ephemeral",
    expiresAt: new Date(now.getTime() + 7 * DAY_MS),
    purpose: "artifact",
    noteId: NoteId.create(noteId),
    noteVersion: 0,
    uploadedBy: null,
  };
  h.backend.scope(userScope).storedFiles.set(file.id, file);
  return file;
};

describe("trashNote", () => {
  it("TC-note-662: moves the note to the trash and sets purgeAfter 30 days out", async () => {
    const h = createTestHarness();
    const noteId = await createPersonalNote(h);
    const now = h.clock.now();

    const view = await trash(h, noteId);

    expect(view).toEqual({
      noteId,
      version: 1,
      trashedAt: now,
      purgeAfter: new Date(now.getTime() + 30 * DAY_MS),
    });
    const note = storedNote(h, noteId);
    expect(note?.lifecycle).toBe("trashed");
    expect(note?.version).toBe(1);
    expect(eventsOfType(h, "note.trashed")).toHaveLength(1);
    // The public projection is read from the revision, so a trash that
    // did not bump would leave the note visible to the consumer.
    expect(h.backend.scope(userScope).projectionRevisions.get(noteId)).toBe(2);
  });

  it("TC-note-663: a public note stops answering the public route once trashed", async () => {
    const h = createTestHarness();
    const noteId = await createPersonalNote(h);
    reseedNote(h, noteId, { visibility: "public" });
    const anonymous = {
      container: h.container,
      input: { noteId, userId: null },
    };
    expect((await getNote(anonymous)).visibility).toBe("public");

    await trash(h, noteId);

    await expect(getNote(anonymous)).rejects.toSatisfy(isNotFoundError);
  });

  it("TC-note-664: an unlisted note's share link stops resolving once trashed", async () => {
    const h = createTestHarness();
    const noteId = await createPersonalNote(h);
    reseedNote(h, noteId, { visibility: "unlisted" });
    expect(anonymousAccess(h, noteId)).toBe("granted");

    await trash(h, noteId);

    expect(anonymousAccess(h, noteId)).toBe("denied");
  });

  it("TC-note-665: a note still converting has its job cancelled before it is deleted", async () => {
    const h = createTestHarness();
    const noteId = await createPersonalNote(h);
    reseedNote(h, noteId, { contentStatus: "processing" });
    const jobs = recordingTrashJobs([job("job-conversion", "conversion")]);

    await trash(h, noteId, { jobs });

    expect(jobs.canceled).toEqual(["job-conversion"]);
    expect(storedNote(h, noteId)?.lifecycle).toBe("trashed");
  });

  it("TC-note-666: with excludingJobId null every unterminated job of the note is cancelled", async () => {
    const h = createTestHarness();
    const noteId = await createPersonalNote(h);
    const jobs = recordingTrashJobs([
      job("job-a", "pdfExport"),
      job("job-b", "referenceImport"),
      job("job-c", "regeneration"),
    ]);

    await trash(h, noteId, { jobs, excludingJobId: null });

    expect(jobs.sweeps()).toBe(1);
    expect(jobs.canceled).toEqual(["job-a", "job-b", "job-c"]);
  });

  it("TC-note-667: a full sweep arms the job.terminationContinued continuation", async () => {
    const h = createTestHarness();
    const noteId = await createPersonalNote(h);
    const full = Array.from({ length: 100 }, (_, index) =>
      job(`job-${index}`, "pdfExport"),
    );

    await trash(h, noteId, { jobs: recordingTrashJobs(full) });

    const armed = scheduledTasks(h).filter(
      (task) => task.kind === JOB_TERMINATION_CONTINUATION_KIND,
    );
    expect(armed).toHaveLength(1);
    expect(armed[0]?.operationId).toBe(noteId);
  });

  it("TC-note-667: a sweep one short of the limit arms no continuation", async () => {
    const h = createTestHarness();
    const noteId = await createPersonalNote(h);
    const partial = Array.from({ length: 99 }, (_, index) =>
      job(`job-${index}`, "pdfExport"),
    );

    await trash(h, noteId, { jobs: recordingTrashJobs(partial) });

    expect(
      scheduledTasks(h).filter(
        (task) => task.kind === JOB_TERMINATION_CONTINUATION_KIND,
      ),
    ).toEqual([]);
  });

  it("TC-note-668: the continuation origin carries the excludingJobId so the exemption survives round two", async () => {
    const h = createTestHarness();
    const noteId = await createPersonalNote(h);
    const full = Array.from({ length: 100 }, (_, index) =>
      job(`job-${index}`, "bulkDelete"),
    );

    await trash(h, noteId, {
      jobs: recordingTrashJobs(full),
      excludingJobId: "job-7",
    });

    const armed = scheduledTasks(h).find(
      (task) => task.kind === JOB_TERMINATION_CONTINUATION_KIND,
    );
    expect(armed?.payload).toEqual({
      origin: { path: "trashNote", noteId, excludingJobId: "job-7" },
    });
  });

  it("TC-note-669: excludingJobId exempts exactly its own job and no other of the same note", async () => {
    const h = createTestHarness();
    const noteId = await createPersonalNote(h);
    const jobs = recordingTrashJobs([
      job("job-bulk-child", "bulkDelete"),
      job("job-conversion", "conversion"),
      job("job-export", "pdfExport"),
      job("job-other-bulk", "bulkMove"),
    ]);

    await trash(h, noteId, { jobs, excludingJobId: "job-bulk-child" });

    expect(jobs.canceled).toEqual([
      "job-conversion",
      "job-export",
      "job-other-bulk",
    ]);
  });

  it("TC-note-670: an excludingJobId that targets another note exempts nothing", async () => {
    const h = createTestHarness();
    const noteId = await createPersonalNote(h);
    const jobs = recordingTrashJobs([
      job("job-a", "pdfExport"),
      job("job-b", "conversion"),
    ]);

    await trash(h, noteId, { jobs, excludingJobId: "job-of-another-note" });

    expect(jobs.canceled).toEqual(["job-a", "job-b"]);
  });

  it("TC-note-671: a body left processing by a cancelled conversion is recovered as failed(canceled)", async () => {
    const h = createTestHarness();
    const noteId = await createPersonalNote(h);
    reseedNote(h, noteId, { contentStatus: "processing" });

    await trash(h, noteId, {
      jobs: recordingTrashJobs([job("job-conversion", "conversion")]),
    });

    const note = storedNote(h, noteId);
    expect(note?.content).toEqual({ status: "failed", reason: "canceled" });
    const failed = eventsOfType(h, "note.conversionFailed");
    expect(failed).toHaveLength(1);
    expect(failed[0]?.payload).toMatchObject({ noteId, reason: "canceled" });
  });

  it("TC-note-671: a processing body with no conversion among the cancelled jobs is left alone", async () => {
    const h = createTestHarness();
    const noteId = await createPersonalNote(h);
    reseedNote(h, noteId, { contentStatus: "processing" });

    await trash(h, noteId, {
      jobs: recordingTrashJobs([job("job-export", "pdfExport")]),
    });

    expect(storedNote(h, noteId)?.content.status).toBe("processing");
    expect(eventsOfType(h, "note.conversionFailed")).toHaveLength(0);
  });

  it("TC-note-672: the recovery is applied before the trash — two transitions, in that order", async () => {
    const h = createTestHarness();
    const noteId = await createPersonalNote(h);
    reseedNote(h, noteId, { contentStatus: "processing" });

    await trash(h, noteId, {
      jobs: recordingTrashJobs([job("job-conversion", "conversion")]),
    });

    const note = storedNote(h, noteId);
    expect(note?.lifecycle).toBe("trashed");
    expect(note?.content).toEqual({ status: "failed", reason: "canceled" });
    expect(note?.version).toBe(2);
    expect(outboxTypes(h).slice(-2)).toEqual([
      "note.conversionFailed",
      "note.trashed",
    ]);
  });

  it("TC-note-672: recovery and trash share one transaction — a commit lost after them persists neither", async () => {
    const h = createTestHarness();
    const noteId = await createPersonalNote(h);
    reseedNote(h, noteId, { contentStatus: "processing" });
    const real = h.container.scopeUnitOfWorkProvider;
    const container = {
      ...h.container,
      // The window opens after the usecase's callback has done all its
      // writes and before the transaction commits.
      scopeUnitOfWorkProvider: {
        run: ((scope, body) =>
          real.run(scope, async (ctx) => {
            await body(ctx);
            throw new Error("commit lost");
          })) as typeof real.run,
      },
    };

    await expect(
      trashNote({
        container,
        input: {
          noteId,
          userId: OWNER,
          expectedVersion: 0,
          excludingJobId: null,
        },
        jobs: recordingTrashJobs([job("job-conversion", "conversion")]),
      }),
    ).rejects.toThrow("commit lost");

    const note = storedNote(h, noteId);
    expect(note?.lifecycle).toBe("active");
    expect(note?.content.status).toBe("processing");
    expect(outboxTypes(h)).not.toContain("note.trashed");
    expect(outboxTypes(h)).not.toContain("note.conversionFailed");
  });

  it("TC-note-673: a cancelled regeneration leaves the ready body untouched", async () => {
    const h = createTestHarness();
    const noteId = await createPersonalNote(h);
    const jobs = recordingTrashJobs([job("job-regeneration", "regeneration")]);

    await trash(h, noteId, { jobs });

    expect(jobs.canceled).toEqual(["job-regeneration"]);
    expect(storedNote(h, noteId)?.content.status).toBe("ready");
    expect(eventsOfType(h, "note.conversionFailed")).toHaveLength(0);
  });

  it("TC-note-674: nothing is reclaimed — the sweep by target returns no batch parent", async () => {
    const h = createTestHarness();
    const noteId = await createPersonalNote(h);
    const artifact = seedArtifact(h, noteId);

    await trash(h, noteId, {
      jobs: recordingTrashJobs([job("job-export", "pdfExport")]),
    });

    expect(h.backend.scope(userScope).storedFiles.get(artifact.id)).toBe(
      artifact,
    );
    expect(outboxTypes(h)).not.toContain("storage.fileDeleted");
  });

  it("TC-note-675: an anonymous export job is cancelled too — the sweep does not read the requester", async () => {
    const h = createTestHarness();
    const noteId = await createPersonalNote(h);
    const jobs = recordingTrashJobs([job("job-anonymous-pdf", "pdfExport")]);

    await trash(h, noteId, { jobs });

    expect(jobs.canceled).toEqual(["job-anonymous-pdf"]);
  });

  it("TC-note-676: an unexpired artifact of a succeeded export survives, left to its own expiry", async () => {
    const h = createTestHarness();
    const noteId = await createPersonalNote(h);
    const artifact = seedArtifact(h, noteId);

    await trash(h, noteId);

    const kept = h.backend.scope(userScope).storedFiles.get(artifact.id);
    expect(kept?.retention === "ephemeral" ? kept.expiresAt : null).toEqual(
      artifact.expiresAt,
    );
  });

  it("TC-note-677: trashing a note already in the trash succeeds without changing it", async () => {
    const h = createTestHarness();
    const noteId = await createPersonalNote(h);
    const first = await trash(h, noteId);
    h.clock.advance(60_000);

    const second = await trash(h, noteId, { expectedVersion: 0 });

    expect(second).toEqual(first);
    expect(second.version).toBe(1);
    expect(storedNote(h, noteId)?.version).toBe(1);
    expect(eventsOfType(h, "note.trashed")).toHaveLength(1);
  });

  it("TC-note-812: the response carries the version the move left, so the undo needs no second read", async () => {
    const h = createTestHarness();
    const noteId = await createPersonalNote(h);

    const view = await trash(h, noteId);

    expect(view.version).toBe(storedNote(h, noteId)?.version);
    await expect(
      restoreNote({
        container: h.container,
        input: { noteId, userId: OWNER, expectedVersion: view.version },
      }),
    ).resolves.toMatchObject({ noteId });
  });

  it("TC-note-813: a move that also recovered a cancelled conversion answers two versions on — counting from the version sent would conflict", async () => {
    const h = createTestHarness();
    const noteId = await createPersonalNote(h);
    reseedNote(h, noteId, { contentStatus: "processing" });

    const view = await trash(h, noteId, {
      jobs: recordingTrashJobs([job("job-conversion", "conversion")]),
    });

    expect(view.version).toBe(2);
    const restore = (expectedVersion: number) =>
      restoreNote({
        container: h.container,
        input: { noteId, userId: OWNER, expectedVersion },
      });
    await expect(restore(1)).rejects.toSatisfy(isConflictError);
    await expect(restore(view.version)).resolves.toMatchObject({ noteId });
  });

  it("TC-note-678: a workspace viewer is answered NOTE_NOT_FOUND and writes nothing", async () => {
    const h = createTestHarness();
    await seedWorkspace(h, [
      { userId: OWNER, role: "owner" },
      { userId: VIEWER, role: "viewer" },
    ]);
    const noteId = await createWorkspaceNote(h);

    await expect(trash(h, noteId, { userId: VIEWER })).rejects.toSatisfy(
      isNotFoundError,
    );
    const note = storedNote(h, noteId, workspaceScope);
    expect(note?.lifecycle).toBe("active");
    expect(note?.version).toBe(0);
  });

  it("TC-note-679: a trashed note leaves the active listing", async () => {
    const h = createTestHarness();
    const kept = await createPersonalNote(h);
    const removed = await createPersonalNote(h);

    await trash(h, removed);

    const list = await listNotes({
      container: h.container,
      input: { userId: OWNER },
    });
    expect(list.items.map((item) => item.noteId)).toEqual([kept]);
    expect(list.count).toBe(1);
  });

  it("TC-note-680: a trashed note appears in the trash listing", async () => {
    const h = createTestHarness();
    const active = await createPersonalNote(h);
    const noteId = await createPersonalNote(h);

    await trash(h, noteId);

    const trashed = await h.container
      .noteReaderFor(userScope)
      .listByOwner(NoteOwner.user(UserId.create(OWNER)), "trashed", {
        page: 1,
        limit: 50,
      });
    expect(trashed.items.map((note) => note.id)).toEqual([noteId]);
    expect(trashed.items.map((note) => note.id)).not.toContain(active);
  });

  it("TC-note-681: a stale expectedVersion is refused with OPTIMISTIC_LOCK_FAILURE", async () => {
    const h = createTestHarness();
    const noteId = await createPersonalNote(h);
    await renameNote({
      container: h.container,
      input: { noteId, userId: OWNER, title: "他者の更新", expectedVersion: 0 },
    });

    await expect(trash(h, noteId, { expectedVersion: 0 })).rejects.toSatisfy(
      (error) =>
        isConflictError(error) && error.code === "OPTIMISTIC_LOCK_FAILURE",
    );
    expect(storedNote(h, noteId)?.lifecycle).toBe("active");
  });

  it("TC-note-793: the first note into an empty trash arms the sweep at its own purgeAfter", async () => {
    const h = createTestHarness();
    const noteId = await createPersonalNote(h);

    const view = await trash(h, noteId);

    // Step 5 reads the deadline back inside the transaction that trashed
    // the note, so the answer has to include the row this turn flipped.
    expect(h.backend.scope(userScope).scheduledTasks.values()).toEqual([
      expect.objectContaining({
        kind: TRASH_EXPIRY_TASK_KIND,
        operationId: TRASH_EXPIRY_OPERATION_ID,
        priority: ScopeTaskPriority.expiryCollection,
        dueAt: view.purgeAfter,
      }),
    ]);
  });

  it("TC-note-793: a later note joining the trash leaves the sweep on the earliest purgeAfter", async () => {
    const h = createTestHarness();
    const first = await trash(h, await createPersonalNote(h));
    h.clock.advance(DAY_MS);
    const second = await trash(h, await createPersonalNote(h));

    expect(second.purgeAfter.getTime()).toBeGreaterThan(
      first.purgeAfter.getTime(),
    );
    expect(h.backend.scope(userScope).scheduledTasks.values()).toEqual([
      expect.objectContaining({
        kind: TRASH_EXPIRY_TASK_KIND,
        operationId: TRASH_EXPIRY_OPERATION_ID,
        priority: ScopeTaskPriority.expiryCollection,
        dueAt: first.purgeAfter,
      }),
    ]);
  });
});
