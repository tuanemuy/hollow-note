import { ScopeKey } from "@repo/core/application/scope";
import { Version } from "@repo/core/domain/common/version";
import { UserId } from "@repo/core/domain/identity/valueObject";
import { NoteId } from "@repo/core/domain/note/valueObject";
import type { EphemeralFile } from "@repo/core/domain/storage/storedFile";
import { StoredFile } from "@repo/core/domain/storage/storedFile";
import {
  ByteSize,
  Checksum,
  FileName,
  MimeType,
  ObjectKey,
  StorageOwner,
  StoredFileId,
} from "@repo/core/domain/storage/valueObject";
import { WorkspaceId } from "@repo/core/domain/workspace/valueObject";
import { describe, expect, it } from "vitest";
import { createTestHarness, type TestHarness } from "../../__tests__/helpers";
import type { ScopeUnitOfWorkContext } from "../../execution/unitOfWork";
import { ScopeTaskPriority } from "../../ports/scopeTaskScheduler";
import {
  ORPHAN_MEDIA_OPERATION_ID,
  ORPHAN_MEDIA_SWEEP_INTERVAL_MS,
  ORPHAN_MEDIA_TASK_KIND,
} from "../collectOrphanMedia";
import {
  type MovedFileMetadata,
  type RelocateFilesForNoteView,
  relocateFilesForNote,
} from "../relocateFilesForNote";

const USER = "user-1";
const WORKSPACE = "workspace-1";
const userId = UserId.create(USER);
const workspaceId = WorkspaceId.create(WORKSPACE);

const sourceOwner = StorageOwner.user(userId);
const targetOwner = StorageOwner.workspace(workspaceId);
const sourceScope = ScopeKey.user(userId);
const targetScope = ScopeKey.workspace(workspaceId);

const NOTE = NoteId.create("note-1");
const OTHER_NOTE = NoteId.create("note-2");
const MIGRATION = "migration-1";
const CHECKSUM = Checksum.sha256("c".repeat(64));

const scopeOf = (owner: StorageOwner): ScopeKey =>
  owner.type === "user"
    ? ScopeKey.user(owner.userId)
    : ScopeKey.workspace(owner.workspaceId);

type FileSeed = Readonly<{
  id: string;
  purpose: "source" | "media" | "reference" | "avatar";
  owner?: StorageOwner;
  noteId?: NoteId;
  size?: number;
}>;

/** Registers one persistent row through the domain factory. */
async function seedFile(h: TestHarness, seed: FileSeed): Promise<StoredFile> {
  const owner = seed.owner ?? sourceOwner;
  const fileId = StoredFileId.create(seed.id);
  const registered = StoredFile.register(
    {
      id: seed.id,
      owner,
      objectKey: ObjectKey.build(owner, seed.purpose, fileId, "bin"),
      fileName: `${seed.id}.bin`,
      mimeType: "application/octet-stream",
      size: seed.size ?? 10,
      checksum: CHECKSUM,
      ...(seed.purpose === "avatar"
        ? ({ purpose: seed.purpose, noteId: null, uploadedBy: userId } as const)
        : ({
            purpose: seed.purpose,
            noteId: seed.noteId ?? NOTE,
            uploadedBy: userId,
          } as const)),
    },
    h.clock.now(),
  );
  await h.container.scopeUnitOfWorkProvider.run(scopeOf(owner), (ctx) =>
    ctx.storedFileRepository.insert(registered.entity),
  );
  return registered.entity;
}

/** No registration path mints an artifact, so its ephemeral row is built here. */
async function seedArtifact(h: TestHarness, id: string): Promise<void> {
  const fileId = StoredFileId.create(id);
  const now = h.clock.now();
  const file: EphemeralFile = {
    id: fileId,
    owner: sourceOwner,
    objectKey: ObjectKey.build(sourceOwner, "artifact", fileId, "pdf"),
    fileName: FileName.create(`${id}.pdf`),
    mimeType: MimeType.create("application/pdf"),
    size: ByteSize.create(64),
    checksum: CHECKSUM,
    version: Version.initial(),
    createdAt: now,
    updatedAt: now,
    retention: "ephemeral",
    expiresAt: new Date(now.getTime() + 60_000),
    purpose: "artifact",
    noteId: NOTE,
    noteVersion: 1,
    uploadedBy: userId,
  };
  await h.container.scopeUnitOfWorkProvider.run(sourceScope, (ctx) =>
    ctx.storedFileRepository.insert(file),
  );
}

type PhaseInput = Readonly<{
  phase: "snapshotSource" | "stageTarget" | "retireSource";
  scope: ScopeKey;
  owner: StorageOwner;
  targetOwner: StorageOwner;
  files?: readonly MovedFileMetadata[];
  migrationId?: string;
  noteId?: NoteId;
}>;

/** Runs one phase inside the scope transaction the move would enclose it in. */
const runPhase = (
  h: TestHarness,
  input: PhaseInput,
): Promise<RelocateFilesForNoteView> =>
  h.container.scopeUnitOfWorkProvider.run(
    input.scope,
    (ctx: ScopeUnitOfWorkContext) =>
      relocateFilesForNote(ctx, {
        migrationId: input.migrationId ?? MIGRATION,
        phase: input.phase,
        noteId: input.noteId ?? NOTE,
        owner: input.owner,
        targetOwner: input.targetOwner,
        ...(input.files !== undefined ? { files: input.files } : {}),
        now: h.clock.now(),
      }),
  );

const snapshot = (h: TestHarness): Promise<RelocateFilesForNoteView> =>
  runPhase(h, {
    phase: "snapshotSource",
    scope: sourceScope,
    owner: sourceOwner,
    targetOwner,
  });

const stage = (
  h: TestHarness,
  files: readonly MovedFileMetadata[],
): Promise<RelocateFilesForNoteView> =>
  runPhase(h, {
    phase: "stageTarget",
    scope: targetScope,
    owner: targetOwner,
    targetOwner,
    files,
  });

const retire = (
  h: TestHarness,
  files: readonly MovedFileMetadata[],
): Promise<RelocateFilesForNoteView> =>
  runPhase(h, {
    phase: "retireSource",
    scope: sourceScope,
    owner: sourceOwner,
    targetOwner,
    files,
  });

const filesIn = (h: TestHarness, scope: ScopeKey): readonly StoredFile[] =>
  h.backend.scope(scope).storedFiles.values();

const outboxTypes = (h: TestHarness): readonly string[] =>
  h.backend.outbox.values().map((row) => row.type);

/** The orphan-media sweep rows of one scope, as `(operationId, dueAt)`. */
const sweepRows = (h: TestHarness, scope: ScopeKey) =>
  h.backend
    .scope(scope)
    .scheduledTasks.values()
    .filter((task) => task.kind === ORPHAN_MEDIA_TASK_KIND)
    .map((task) => ({
      operationId: task.operationId,
      dueAt: task.state === "failed" ? null : task.dueAt,
    }));

describe("relocateFilesForNote", () => {
  it("TC-storage-134: snapshotSource returns the note's three portable rows and deletes nothing", async () => {
    const h = createTestHarness();
    const source = await seedFile(h, { id: "file-source", purpose: "source" });
    const media = await seedFile(h, { id: "file-media", purpose: "media" });
    const reference = await seedFile(h, {
      id: "file-reference",
      purpose: "reference",
    });

    const result = await snapshot(h);

    expect(result.relocatedCount).toBe(3);
    expect([...result.files].map((file) => file.id).sort()).toEqual([
      "file-media",
      "file-reference",
      "file-source",
    ]);
    expect([...result.files].map((file) => file.purpose).sort()).toEqual([
      "media",
      "reference",
      "source",
    ]);
    // Portable projection: everything but the owner travels unchanged.
    const snapshotOf = (id: string): MovedFileMetadata | undefined =>
      result.files.find((file) => file.id === id);
    expect(snapshotOf("file-source")).toMatchObject({
      objectKey: source.objectKey,
      fileName: source.fileName,
      mimeType: source.mimeType,
      size: source.size,
      checksum: source.checksum,
      noteId: NOTE,
      uploadedBy: userId,
      expiresAt: null,
    });
    expect(snapshotOf("file-media")?.objectKey).toBe(media.objectKey);
    expect(snapshotOf("file-reference")?.objectKey).toBe(reference.objectKey);
    // The route still points at the source, so nothing may be removed yet.
    expect(filesIn(h, sourceScope)).toHaveLength(3);
    expect(filesIn(h, targetScope)).toHaveLength(0);
  });

  it("TC-storage-026: media that arrives by a move arms the target scope's orphan sweep", async () => {
    const h = createTestHarness();
    await seedFile(h, { id: "file-media", purpose: "media" });
    await seedFile(h, { id: "file-source", purpose: "source" });
    const { files } = await snapshot(h);
    const stagedAt = h.clock.now();

    await stage(h, files);

    // Without this, a scope whose only media arrived by a move would
    // never sweep: `storeMedia` arms on the *first* media, and the
    // staged rows already make that answer "no".
    expect(sweepRows(h, targetScope)).toEqual([
      {
        operationId: ORPHAN_MEDIA_OPERATION_ID,
        dueAt: new Date(stagedAt.getTime() + ORPHAN_MEDIA_SWEEP_INTERVAL_MS),
      },
    ]);
  });

  it("TC-storage-026: a move carrying no media leaves the target scope's sweep unarmed", async () => {
    const h = createTestHarness();
    await seedFile(h, { id: "file-source", purpose: "source" });
    await seedFile(h, { id: "file-reference", purpose: "reference" });
    const { files } = await snapshot(h);

    await stage(h, files);

    expect(sweepRows(h, targetScope)).toEqual([]);
  });

  it("TC-storage-026: a move into a scope that already holds media leaves the sweep where it is", async () => {
    const h = createTestHarness();
    await seedFile(h, {
      id: "file-there",
      purpose: "media",
      owner: targetOwner,
      noteId: OTHER_NOTE,
    });
    const armedAt = h.clock.now();
    await h.container.scopeUnitOfWorkProvider.run(targetScope, (ctx) =>
      ctx.scopeTaskScheduler.schedule({
        kind: ORPHAN_MEDIA_TASK_KIND,
        operationId: ORPHAN_MEDIA_OPERATION_ID,
        priority: ScopeTaskPriority.expiryCollection,
        dueAt: new Date(armedAt.getTime() + ORPHAN_MEDIA_SWEEP_INTERVAL_MS),
        payload: {},
      }),
    );
    await seedFile(h, { id: "file-media", purpose: "media" });
    const { files } = await snapshot(h);
    h.clock.advance(ORPHAN_MEDIA_SWEEP_INTERVAL_MS / 2);

    await stage(h, files);

    // `schedule` overwrites `dueAt`, so arming again on a scope that
    // already sweeps would push the sweep it is waiting for out of reach.
    expect(sweepRows(h, targetScope)).toEqual([
      {
        operationId: ORPHAN_MEDIA_OPERATION_ID,
        dueAt: new Date(armedAt.getTime() + ORPHAN_MEDIA_SWEEP_INTERVAL_MS),
      },
    ]);
  });

  it("TC-storage-134: rows of another note in the same scope stay behind", async () => {
    const h = createTestHarness();
    await seedFile(h, { id: "file-mine", purpose: "source" });
    await seedFile(h, {
      id: "file-theirs",
      purpose: "source",
      noteId: OTHER_NOTE,
    });

    const result = await snapshot(h);

    expect(result.files.map((file) => file.id)).toEqual(["file-mine"]);
  });

  it("TC-storage-135: an artifact of the same note is left in place", async () => {
    const h = createTestHarness();
    await seedFile(h, { id: "file-source", purpose: "source" });
    await seedArtifact(h, "file-artifact");

    const result = await snapshot(h);

    expect(result.relocatedCount).toBe(1);
    expect(result.files.map((file) => file.id)).toEqual(["file-source"]);
    expect(result.files.map((file) => file.purpose)).not.toContain("artifact");
    // It is reclaimed by its own TTL, not by the move.
    expect(filesIn(h, sourceScope).map((file) => file.id)).toContain(
      "file-artifact",
    );
  });

  it("TC-storage-141: an avatar in the same scope belongs to no note and is not snapshotted", async () => {
    const h = createTestHarness();
    await seedFile(h, { id: "file-source", purpose: "source" });
    await seedFile(h, { id: "file-avatar", purpose: "avatar" });

    const result = await snapshot(h);

    expect(result.files.map((file) => file.id)).toEqual(["file-source"]);
    expect(filesIn(h, sourceScope).map((file) => file.id)).toContain(
      "file-avatar",
    );
  });

  it("TC-storage-136: stageTarget registers the same object keys under the target owner without touching R2", async () => {
    const h = createTestHarness();
    await seedFile(h, { id: "file-source", purpose: "source", size: 11 });
    await seedFile(h, { id: "file-media", purpose: "media", size: 22 });
    const objectsBefore = h.backend.objects.size;

    const { files } = await snapshot(h);
    const result = await stage(h, files);

    expect(result.relocatedCount).toBe(2);
    const staged = [...filesIn(h, targetScope)].sort((a, b) =>
      a.id < b.id ? -1 : 1,
    );
    expect(staged).toHaveLength(2);
    for (const row of staged) {
      expect(row.owner).toEqual({ type: "workspace", workspaceId: WORKSPACE });
      // The bytes never move: the staged row points at the source's key.
      expect(row.objectKey).toBe(
        files.find((file) => file.id === row.id)?.objectKey,
      );
      expect(row.version).toBe(Version.initial());
    }
    expect(staged.map((row) => row.size)).toEqual([22, 11]);
    // No R2 copy and no storage.fileStored: the object is untouched.
    expect(h.backend.objects.size).toBe(objectsBefore);
    expect(outboxTypes(h)).not.toContain("storage.fileStored");
    // The source rows survive the staging.
    expect(filesIn(h, sourceScope)).toHaveLength(2);
  });

  it("TC-storage-137: staging the same migration id twice registers the metadata once", async () => {
    const h = createTestHarness();
    await seedFile(h, { id: "file-source", purpose: "source" });
    await seedFile(h, { id: "file-media", purpose: "media" });

    const { files } = await snapshot(h);
    const first = await stage(h, files);
    const second = await stage(h, files);

    expect(first.relocatedCount).toBe(2);
    // `applied_operations` swallows the replay rather than colliding on
    // the primary key — a duplicate insert would throw instead.
    expect(second.relocatedCount).toBe(0);
    expect(filesIn(h, targetScope)).toHaveLength(2);
  });

  it("TC-storage-137: a different migration id is not deduplicated against the first", async () => {
    const h = createTestHarness();
    await seedFile(h, { id: "file-source", purpose: "source" });

    const { files } = await snapshot(h);
    await stage(h, files);

    // The guard is keyed on the migration, so a second migration reaches
    // the insert and the repository's duplicate-key contract answers.
    await expect(
      runPhase(h, {
        phase: "stageTarget",
        scope: targetScope,
        owner: targetOwner,
        targetOwner,
        files,
        migrationId: "migration-2",
      }),
    ).rejects.toThrow();
    expect(filesIn(h, targetScope)).toHaveLength(1);
  });

  it("TC-storage-138: staged metadata is invisible while the active route still names the source", async () => {
    const h = createTestHarness();
    await seedFile(h, { id: "file-source", purpose: "source" });
    await h.container.noteRouteStore.reserveCreate({
      noteId: NOTE,
      scope: sourceScope,
      createdBy: userId,
      operationId: "op-create",
      expiresAt: new Date(h.clock.now().getTime() + 60_000),
    });
    await h.container.noteRouteStore.activateCreate({
      noteId: NOTE,
      operationId: "op-create",
    });

    const { files } = await snapshot(h);
    await stage(h, files);

    // Route switch has not happened, so the reader still resolves the
    // source scope and only the source rows are reachable through it.
    const route = await h.container.noteRouteStore.resolve(NOTE);
    expect(route?.scope).toEqual(sourceScope);
    const reachable = await h.container.scopeUnitOfWorkProvider.run(
      route?.scope ?? sourceScope,
      (ctx) =>
        ctx.storedFileRepository.listByOwner(sourceOwner, "source", {
          page: 1,
          limit: 10,
        }),
    );
    expect(reachable.items.map((file) => file.owner)).toEqual([
      { type: "user", userId: USER },
    ]);
  });

  it("TC-storage-139: retireSource drops the source rows and emits no delete event", async () => {
    const h = createTestHarness();
    await seedFile(h, { id: "file-source", purpose: "source" });
    await seedFile(h, { id: "file-media", purpose: "media" });
    const objectsBefore = h.backend.objects.size;

    const { files } = await snapshot(h);
    await stage(h, files);
    const result = await retire(h, files);

    expect(result.relocatedCount).toBe(2);
    expect(filesIn(h, sourceScope)).toHaveLength(0);
    // The target row references the same key, so reclaiming the object
    // would destroy live data.
    expect(outboxTypes(h)).not.toContain("storage.fileDeleted");
    expect(h.backend.objects.size).toBe(objectsBefore);
    expect(filesIn(h, targetScope)).toHaveLength(2);
  });

  it("TC-storage-140: replaying retireSource cleans only the source and keeps the target references", async () => {
    const h = createTestHarness();
    await seedFile(h, { id: "file-source", purpose: "source" });

    const { files } = await snapshot(h);
    await stage(h, files);
    const first = await retire(h, files);
    const second = await retire(h, files);

    expect(first.relocatedCount).toBe(1);
    expect(second.relocatedCount).toBe(0);
    expect(filesIn(h, sourceScope)).toHaveLength(0);
    expect(filesIn(h, targetScope).map((file) => file.id)).toEqual([
      "file-source",
    ]);
    expect(outboxTypes(h)).not.toContain("storage.fileDeleted");
  });

  it("a note with no relocatable row succeeds with relocatedCount 0 in every phase", async () => {
    const h = createTestHarness();
    await seedFile(h, { id: "file-avatar", purpose: "avatar" });

    const snapshotted = await snapshot(h);
    expect(snapshotted).toEqual({ relocatedCount: 0, files: [] });
    expect(await stage(h, [])).toEqual({ relocatedCount: 0, files: [] });
    expect(await retire(h, [])).toEqual({ relocatedCount: 0, files: [] });
    expect(filesIn(h, targetScope)).toHaveLength(0);
  });

  it("retireSource tolerates a row that is already gone", async () => {
    const h = createTestHarness();
    await seedFile(h, { id: "file-source", purpose: "source" });
    await seedFile(h, { id: "file-media", purpose: "media" });

    const { files } = await snapshot(h);
    await h.container.scopeUnitOfWorkProvider.run(sourceScope, async (ctx) => {
      const stored = await ctx.storedFileRepository.findById(
        StoredFileId.create("file-media"),
      );
      if (stored === null) {
        throw new Error("seed missing");
      }
      await ctx.storedFileRepository.delete(
        stored.entity.id,
        stored.expectedVersion,
      );
    });

    const result = await retire(h, files);

    expect(result.relocatedCount).toBe(1);
    expect(filesIn(h, sourceScope)).toHaveLength(0);
  });
});
