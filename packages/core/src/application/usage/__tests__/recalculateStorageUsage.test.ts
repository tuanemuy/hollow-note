import { ScopeKey } from "@repo/core/application/scope";
import { Version } from "@repo/core/domain/common/version";
import { UserId } from "@repo/core/domain/identity/valueObject";
import { Note } from "@repo/core/domain/note/note";
import { NoteId, NoteOwner } from "@repo/core/domain/note/valueObject";
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
import { StorageQuota } from "@repo/core/domain/usage/storageQuota";
import { QuotaSubject } from "@repo/core/domain/usage/valueObject";
import { WorkspaceId } from "@repo/core/domain/workspace/valueObject";
import { describe, expect, it } from "vitest";
import { createTestHarness, type TestHarness } from "../../__tests__/helpers";
import {
  type RecalculateStorageUsageInput,
  recalculateStorageUsage,
} from "../recalculateStorageUsage";

const USER_ID = "user-1";
const WORKSPACE_ID = "workspace-1";
const userId = UserId.create(USER_ID);
const owner = StorageOwner.user(userId);
const scope = ScopeKey.user(userId);
const subject = QuotaSubject.user(userId);
const CHECKSUM = Checksum.sha256("b".repeat(64));

const recalculate = (
  h: TestHarness,
  overrides: Partial<RecalculateStorageUsageInput> = {},
) =>
  recalculateStorageUsage({
    container: h.container,
    input: {
      userId: USER_ID,
      subjectType: "user",
      subjectId: USER_ID,
      ...overrides,
    },
  });

const storedQuota = (h: TestHarness, target: ScopeKey = scope) =>
  h.backend.scope(target).storageQuotas.values()[0];

const scopeOfOwner = (fileOwner: StorageOwner): ScopeKey =>
  fileOwner.type === "user"
    ? ScopeKey.user(fileOwner.userId)
    : ScopeKey.workspace(fileOwner.workspaceId);

async function seedFile(
  h: TestHarness,
  params: Readonly<{
    id: string;
    bytes: number;
    purpose: "avatar" | "media" | "source";
    target?: StorageOwner;
  }>,
): Promise<void> {
  const fileOwner = params.target ?? owner;
  const fileId = StoredFileId.create(params.id);
  const provenance =
    params.purpose === "avatar"
      ? ({ purpose: "avatar", noteId: null, uploadedBy: userId } as const)
      : ({
          purpose: params.purpose,
          noteId: NoteId.create(`note-of-${params.id}`),
          uploadedBy: userId,
        } as const);
  await h.container.scopeUnitOfWorkProvider.run(
    scopeOfOwner(fileOwner),
    async (ctx) => {
      const registered = StoredFile.register(
        {
          id: params.id,
          owner: fileOwner,
          objectKey: ObjectKey.build(fileOwner, params.purpose, fileId, "png"),
          fileName: `${params.id}.png`,
          mimeType: "image/png",
          size: params.bytes,
          checksum: CHECKSUM,
          ...provenance,
        },
        h.clock.now(),
      );
      await ctx.storedFileRepository.insert(registered.entity);
    },
  );
}

/**
 * Artifacts are only produced by the conversion slice's ephemeral
 * registration, which does not exist yet; the literal is what lets these
 * cases pin the exclusion `sumSizeByOwner` applies (same shape as the
 * conformance suite's fixture).
 */
async function seedArtifact(
  h: TestHarness,
  params: Readonly<{ id: string; bytes: number; target?: StorageOwner }>,
): Promise<void> {
  const fileOwner = params.target ?? owner;
  const fileId = StoredFileId.create(params.id);
  const now = h.clock.now();
  const file: EphemeralFile = {
    id: fileId,
    owner: fileOwner,
    objectKey: ObjectKey.build(fileOwner, "artifact", fileId, "pdf"),
    fileName: FileName.create(`${params.id}.pdf`),
    mimeType: MimeType.create("application/pdf"),
    size: ByteSize.create(params.bytes),
    checksum: CHECKSUM,
    version: Version.initial(),
    createdAt: now,
    updatedAt: now,
    retention: "ephemeral",
    expiresAt: new Date(now.getTime() + 60_000),
    purpose: "artifact",
    noteId: null,
    noteVersion: null,
    uploadedBy: userId,
  };
  await h.container.scopeUnitOfWorkProvider.run(
    scopeOfOwner(fileOwner),
    (ctx) => ctx.storedFileRepository.insert(file),
  );
}

async function seedNote(
  h: TestHarness,
  params: Readonly<{ id: string; trashed: boolean; owner?: NoteOwner }>,
): Promise<void> {
  const noteOwner = params.owner ?? NoteOwner.user(userId);
  const target =
    noteOwner.type === "user"
      ? ScopeKey.user(noteOwner.userId)
      : ScopeKey.workspace(noteOwner.workspaceId);
  const now = h.clock.now();
  await h.container.scopeUnitOfWorkProvider.run(target, async (ctx) => {
    const created = Note.createBlank(
      {
        id: NoteId.create(params.id),
        owner: noteOwner,
        createdBy: userId,
        title: params.id,
        projectionRevision: 1,
      },
      now,
    );
    await ctx.noteRepository.insert(
      params.trashed ? Note.trash(created.entity, now).entity : created.entity,
    );
  });
}

describe("recalculateStorageUsage", () => {
  it("TC-usage-065: a drifted total is replaced by the real one", async () => {
    const h = createTestHarness();
    await h.container.scopeUnitOfWorkProvider.run(scope, (ctx) =>
      ctx.storageQuotaRepository.insert(
        StorageQuota.replaceTotals(
          StorageQuota.initialize(subject, h.clock.now()),
          { consumedBytes: 999, noteCount: 7 },
          h.clock.now(),
        ),
      ),
    );
    await seedFile(h, { id: "file-1", bytes: 120, purpose: "avatar" });
    await seedNote(h, { id: "note-1", trashed: false });

    const view = await recalculate(h);

    expect(view).toEqual({ consumedBytes: 120, noteCount: 1 });
    expect(storedQuota(h)?.consumedBytes).toBe(120);
    expect(storedQuota(h)?.noteCount).toBe(1);
  });

  it("TC-usage-066: artifacts are left out of the total", async () => {
    const h = createTestHarness();
    await seedFile(h, { id: "file-1", bytes: 120, purpose: "media" });
    await seedArtifact(h, { id: "file-2", bytes: 900 });

    expect((await recalculate(h)).consumedBytes).toBe(120);
  });

  it("TC-usage-067: an owner holding only artifacts consumes nothing", async () => {
    const h = createTestHarness();
    await seedArtifact(h, { id: "file-1", bytes: 900 });

    expect((await recalculate(h)).consumedBytes).toBe(0);
  });

  it("TC-usage-068: an owner with no file at all consumes nothing", async () => {
    const h = createTestHarness();

    expect((await recalculate(h)).consumedBytes).toBe(0);
  });

  it("TC-usage-069: trashed notes are counted", async () => {
    const h = createTestHarness();
    await seedNote(h, { id: "note-1", trashed: false });
    await seedNote(h, { id: "note-2", trashed: true });

    expect((await recalculate(h)).noteCount).toBe(2);
  });

  it("TC-usage-070: a missing quota row is created before the values land", async () => {
    const h = createTestHarness();
    await seedFile(h, { id: "file-1", bytes: 64, purpose: "source" });
    expect(h.backend.scope(scope).storageQuotas.values()).toHaveLength(0);

    await recalculate(h);

    const row = storedQuota(h);
    expect(row?.consumedBytes).toBe(64);
    expect(row?.quota.limit).toBe(5 * 1024 * 1024 * 1024);
  });

  it("TC-usage-071: running it twice in a row leaves the same values", async () => {
    const h = createTestHarness();
    await seedFile(h, { id: "file-1", bytes: 64, purpose: "media" });
    await seedNote(h, { id: "note-1", trashed: false });

    const first = await recalculate(h);
    const second = await recalculate(h);

    expect(second).toEqual(first);
    expect(storedQuota(h)?.consumedBytes).toBe(64);
    expect(storedQuota(h)?.noteCount).toBe(1);
  });

  it("TC-usage-072: a workspace subject counts only that workspace", async () => {
    const h = createTestHarness();
    const workspaceId = WorkspaceId.create(WORKSPACE_ID);
    const workspaceOwner = StorageOwner.workspace(workspaceId);
    const workspaceScope = ScopeKey.workspace(workspaceId);
    await seedFile(h, { id: "file-1", bytes: 500, purpose: "media" });
    await seedFile(h, {
      id: "file-2",
      bytes: 40,
      purpose: "media",
      target: workspaceOwner,
    });
    await seedNote(h, {
      id: "note-1",
      trashed: false,
      owner: NoteOwner.workspace(workspaceId),
    });

    const view = await recalculate(h, {
      subjectType: "workspace",
      subjectId: WORKSPACE_ID,
    });

    expect(view).toEqual({ consumedBytes: 40, noteCount: 1 });
    expect(storedQuota(h, workspaceScope)?.consumedBytes).toBe(40);
    expect(h.backend.scope(scope).storageQuotas.values()).toHaveLength(0);
  });

  it("TC-identity-045: a recalculation after the deletion barrier is refused", async () => {
    const h = createTestHarness();
    await h.container.scopeUnitOfWorkProvider.run(scope, (ctx) =>
      ctx.cleanupAdmission.beginPersonalAccountDeletion("deletion-1", userId),
    );

    await expect(recalculate(h)).rejects.toSatisfy(
      (error: unknown) =>
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "ACCOUNT_DELETING",
    );
  });
});
