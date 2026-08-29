import { Version } from "@repo/core/domain/common/version";
import { UserId } from "@repo/core/domain/identity/valueObject";
import { NoteErrorCode } from "@repo/core/domain/note/errorCode";
import { type ActiveNote, Note } from "@repo/core/domain/note/note";
import { NoteRevision } from "@repo/core/domain/note/noteRevision";
import { NoteId, ShareLink } from "@repo/core/domain/note/valueObject";
import { StoredFile } from "@repo/core/domain/storage/storedFile";
import {
  Checksum,
  ObjectKey,
  StorageOwner,
  StoredFileId,
} from "@repo/core/domain/storage/valueObject";
import { StorageQuota } from "@repo/core/domain/usage/storageQuota";
import { QuotaSubject } from "@repo/core/domain/usage/valueObject";
import { WorkspaceErrorCode } from "@repo/core/domain/workspace/errorCode";
import { Membership } from "@repo/core/domain/workspace/membership";
import { WorkspaceId } from "@repo/core/domain/workspace/valueObject";
import { describe, expect, it } from "vitest";
import { createTestHarness, type TestHarness } from "../../__tests__/helpers";
import type { RequestContainer } from "../../di/types";
import { SystemError, SystemErrorCode } from "../../errors";
import type { ScopeUnitOfWorkContext } from "../../execution/unitOfWork";
import { ScopeKey } from "../../scope";
import {
  expectBusinessRule,
  expectConflict,
  expectNotFound,
  outboxRows,
  seedWorkspace,
} from "../../workspace/__tests__/harness";
import { changeMemberRole } from "../../workspace/changeMemberRole";
import { deleteWorkspace } from "../../workspace/deleteWorkspace";
import { removeMember } from "../../workspace/removeMember";
import { createBlankNote } from "../createBlankNote";
import { getNote } from "../getNote";
import { type MovedNoteView, moveNote } from "../moveNote";

const ACTOR = "user-1";
const BOSS = "owner-1";
const OTHER = "user-2";
const TARGET_WS = "workspace-target";
const SOURCE_WS = "workspace-source";
/** `WorkspaceSeed` names the workspace "Workspace" unless told otherwise. */
const WORKSPACE_NAME = "Workspace";

const actorId = UserId.create(ACTOR);
const personalScope = ScopeKey.user(actorId);
const targetScope = ScopeKey.workspace(WorkspaceId.create(TARGET_WS));
const sourceWsScope = ScopeKey.workspace(WorkspaceId.create(SOURCE_WS));
const CHECKSUM = Checksum.sha256("d".repeat(64));

// --- seeding -----------------------------------------------------------

/** The target of a personal → workspace move, with the actor at `role`. */
const seedTarget = (h: TestHarness, role: "owner" | "editor" | "viewer") =>
  seedWorkspace(h, {
    workspaceId: TARGET_WS,
    members: [
      { userId: BOSS, role: "owner" },
      { userId: ACTOR, role, membershipId: "membership-actor" },
    ],
  });

/** The origin of a workspace → personal move. */
const seedSource = (
  h: TestHarness,
  role: "owner" | "editor" | "viewer",
  extra: readonly string[] = [],
) =>
  seedWorkspace(h, {
    workspaceId: SOURCE_WS,
    members: [
      { userId: BOSS, role: "owner" },
      { userId: ACTOR, role, membershipId: "membership-actor" },
      ...extra.map((userId) => ({ userId, role: "editor" as const })),
    ],
  });

const createNote = async (
  h: TestHarness,
  owner: Readonly<{ workspaceId?: string; userId?: string }> = {},
): Promise<string> => {
  const view = await createBlankNote({
    container: h.container,
    input: {
      userId: owner.userId ?? ACTOR,
      ownerType: owner.workspaceId === undefined ? "user" : "workspace",
      ownerWorkspaceId: owner.workspaceId ?? null,
      title: "移動するノート",
    },
  });
  return view.noteId;
};

type MoveInput = Readonly<{
  noteId: string;
  workspaceId?: string;
  userId?: string;
  expectedVersion?: number;
  container?: RequestContainer;
}>;

const move = (h: TestHarness, input: MoveInput): Promise<MovedNoteView> =>
  moveNote({
    container: input.container ?? h.container,
    input: {
      noteId: input.noteId,
      userId: input.userId ?? ACTOR,
      targetOwnerType: input.workspaceId === undefined ? "user" : "workspace",
      targetWorkspaceId: input.workspaceId ?? null,
      expectedVersion: input.expectedVersion ?? 0,
    },
  });

const read = (h: TestHarness, noteId: string, userId: string | null = ACTOR) =>
  getNote({ container: h.container, input: { noteId, userId } });

// --- persisted-state reads --------------------------------------------

const notesIn = (h: TestHarness, scope: ScopeKey) =>
  h.backend.scope(scope).notes.values();

const filesIn = (h: TestHarness, scope: ScopeKey) =>
  h.backend.scope(scope).storedFiles.values();

const revisionsIn = (h: TestHarness, scope: ScopeKey) =>
  h.backend.scope(scope).noteRevisions.values();

const quotaOf = (h: TestHarness, scope: ScopeKey): StorageQuota | undefined =>
  h.backend.scope(scope).storageQuotas.values()[0];

const moveLocksIn = (h: TestHarness, scope: ScopeKey) =>
  h.backend.scope(scope).moveAuthorizationLocks.values();

const routeOf = (h: TestHarness, noteId: string) =>
  h.container.noteRouteStore.resolve(NoteId.create(noteId));

const operations = (h: TestHarness) => h.backend.distributedOperations.values();

// --- state seeding no usecase in this slice produces -------------------

/** Flips a note's body to `processing`, which only conversion can do. */
async function markProcessing(
  h: TestHarness,
  scope: ScopeKey,
  noteId: string,
): Promise<void> {
  await h.container.scopeUnitOfWorkProvider.run(scope, async (ctx) => {
    const stored = await ctx.noteRepository.findById(NoteId.create(noteId));
    if (stored === null) {
      throw new Error(`no note ${noteId}`);
    }
    await ctx.noteRepository.save(
      {
        ...stored.entity,
        content: { status: "processing" },
        version: Version.next(stored.entity.version),
      },
      stored.expectedVersion,
    );
  });
}

/** Publishes a share link; `changeNoteVisibility` lands in a later slice. */
async function makeUnlisted(
  h: TestHarness,
  scope: ScopeKey,
  noteId: string,
): Promise<string> {
  const secret = h.container.secureTokenGenerator.issue();
  const protectedToken = await h.container.shareTokenProtector.protect(
    secret.token,
  );
  await h.container.scopeUnitOfWorkProvider.run(scope, async (ctx) => {
    const stored = await ctx.noteRepository.findById(NoteId.create(noteId));
    if (stored === null || !Note.isActive(stored.entity)) {
      throw new Error(`no active note ${noteId}`);
    }
    const unlisted = Note.makeUnlisted(
      stored.entity,
      ShareLink.create({
        tokenHash: secret.hash,
        protectedToken,
        password: null,
        issuedAt: h.clock.now(),
      }),
      h.clock.now(),
    );
    await ctx.noteRepository.save(unlisted.entity, stored.expectedVersion);
  });
  return secret.token;
}

async function seedRevision(
  h: TestHarness,
  scope: ScopeKey,
  noteId: string,
  id: string,
): Promise<void> {
  await h.container.scopeUnitOfWorkProvider.run(scope, async (ctx) => {
    const stored = await ctx.noteRepository.findById(NoteId.create(noteId));
    if (stored === null || !Note.isActive(stored.entity)) {
      throw new Error(`no active note ${noteId}`);
    }
    await ctx.noteRevisionRepository.insert(
      NoteRevision.capture(
        {
          id,
          note: stored.entity as ActiveNote,
          createdBy: actorId,
          reason: "manualEdit",
        },
        h.clock.now(),
      ),
    );
  });
}

async function seedFile(
  h: TestHarness,
  scope: ScopeKey,
  owner: StorageOwner,
  seed: Readonly<{
    id: string;
    noteId: string;
    purpose: "source" | "media";
    size: number;
  }>,
): Promise<void> {
  const fileId = StoredFileId.create(seed.id);
  const registered = StoredFile.register(
    {
      id: seed.id,
      owner,
      objectKey: ObjectKey.build(owner, seed.purpose, fileId, "bin"),
      fileName: `${seed.id}.bin`,
      mimeType: "application/octet-stream",
      size: seed.size,
      checksum: CHECKSUM,
      purpose: seed.purpose,
      noteId: NoteId.create(seed.noteId),
      uploadedBy: actorId,
    },
    h.clock.now(),
  );
  await h.container.scopeUnitOfWorkProvider.run(scope, (ctx) =>
    ctx.storedFileRepository.insert(registered.entity),
  );
}

async function seedQuota(
  h: TestHarness,
  scope: ScopeKey,
  owner: StorageOwner,
  totals: Readonly<{ bytes: number; notes: number }>,
): Promise<void> {
  const now = h.clock.now();
  const subject = QuotaSubject.fromStorageOwner(owner);
  let quota = StorageQuota.initialize(subject, now);
  if (totals.bytes > 0) {
    quota = StorageQuota.add(quota, totals.bytes, now);
  }
  for (let i = 0; i < totals.notes; i += 1) {
    quota = StorageQuota.incrementNotes(quota, now);
  }
  await h.container.scopeUnitOfWorkProvider.run(scope, (ctx) =>
    ctx.storageQuotaRepository.insert(quota),
  );
}

/** Removes a membership the way a mid-move removal would. */
async function dropMembership(
  h: TestHarness,
  workspaceId: string,
  userId: string,
): Promise<void> {
  const id = WorkspaceId.create(workspaceId);
  await h.container.scopeUnitOfWorkProvider.run(
    ScopeKey.workspace(id),
    async (ctx) => {
      const stored = await ctx.membershipRepository.findByWorkspaceAndUser(
        id,
        UserId.create(userId),
      );
      if (stored === null) {
        throw new Error(`no membership for ${userId}`);
      }
      await ctx.membershipRepository.delete(
        stored.entity.id,
        stored.expectedVersion,
      );
    },
  );
}

/** Bumps the membership's version without removing it (a demotion). */
async function demoteMembership(
  h: TestHarness,
  workspaceId: string,
  userId: string,
): Promise<void> {
  const id = WorkspaceId.create(workspaceId);
  await h.container.scopeUnitOfWorkProvider.run(
    ScopeKey.workspace(id),
    async (ctx) => {
      const stored = await ctx.membershipRepository.findByWorkspaceAndUser(
        id,
        UserId.create(userId),
      );
      if (stored === null) {
        throw new Error(`no membership for ${userId}`);
      }
      const changed = Membership.changeRole(
        stored.entity,
        "viewer",
        h.clock.now(),
      );
      await ctx.membershipRepository.save(
        changed.entity,
        stored.expectedVersion,
      );
    },
  );
}

// --- fault injection ---------------------------------------------------

type RunHooks = Readonly<{
  before?: (scope: ScopeKey, index: number) => Promise<void> | void;
  after?: (scope: ScopeKey, index: number) => Promise<void> | void;
}>;

/**
 * A container that interferes around one scope transaction, identified by
 * its position in the move's fixed sequence: 0 `snapshotSource`,
 * 1 `stageTarget`, 2 `activateTarget`, 3 `retireSource` (and, on a
 * rollback, 2 the target undo and 3 the source lock release).
 */
const withScopeRunHooks = (
  h: TestHarness,
  hooks: RunHooks,
): RequestContainer => {
  let calls = 0;
  return {
    ...h.container,
    scopeUnitOfWorkProvider: {
      run: async <T>(
        scope: ScopeKey,
        fn: (ctx: ScopeUnitOfWorkContext) => Promise<T>,
      ): Promise<T> => {
        const index = calls;
        calls += 1;
        await hooks.before?.(scope, index);
        const result = await h.container.scopeUnitOfWorkProvider.run(scope, fn);
        await hooks.after?.(scope, index);
        return result;
      },
    },
  };
};

const withRouteStore = (
  h: TestHarness,
  overrides: Partial<RequestContainer["noteRouteStore"]>,
): RequestContainer => ({
  ...h.container,
  noteRouteStore: { ...h.container.noteRouteStore, ...overrides },
});

const failure = (detail: string): SystemError =>
  new SystemError(SystemErrorCode.DatabaseError, detail);

describe("moveNote", () => {
  it("TC-note-238: a personal note moves into a workspace the actor edits and note.moved carries the old owner", async () => {
    const h = createTestHarness();
    await seedTarget(h, "editor");
    const noteId = await createNote(h);

    const view = await move(h, { noteId, workspaceId: TARGET_WS });

    expect(view).toEqual({
      noteId,
      ownerType: "workspace",
      ownerId: TARGET_WS,
      droppedTagNames: [],
      version: 1,
    });
    expect(notesIn(h, personalScope)).toHaveLength(0);
    expect(notesIn(h, targetScope)[0]?.owner).toEqual({
      type: "workspace",
      workspaceId: TARGET_WS,
    });
    expect(await routeOf(h, noteId)).toMatchObject({
      state: "active",
      scope: targetScope,
      routeVersion: 2,
    });

    const moved = outboxRows(h, "note.moved");
    expect(moved).toHaveLength(1);
    expect(moved[0]?.payload).toEqual({
      noteId,
      previousOwner: { type: "user", userId: ACTOR },
      currentOwner: { type: "workspace", workspaceId: TARGET_WS },
      routeVersion: 2,
    });
    expect(operations(h)[0]).toMatchObject({
      kind: "noteMove",
      partitionKey: noteId,
      state: "completed",
    });
  });

  it("TC-note-239: a workspace note the actor edits moves back to their personal scope", async () => {
    const h = createTestHarness();
    await seedSource(h, "editor");
    const noteId = await createNote(h, { workspaceId: SOURCE_WS });

    const view = await move(h, { noteId });

    expect(view).toMatchObject({ ownerType: "user", ownerId: ACTOR });
    expect(notesIn(h, sourceWsScope)).toHaveLength(0);
    expect(notesIn(h, personalScope)[0]?.owner).toEqual({
      type: "user",
      userId: ACTOR,
    });
    expect(await routeOf(h, noteId)).toMatchObject({
      state: "active",
      scope: personalScope,
    });
    expect(outboxRows(h, "note.moved")[0]?.payload).toMatchObject({
      previousOwner: { type: "workspace", workspaceId: SOURCE_WS },
      currentOwner: { type: "user", userId: ACTOR },
    });
  });

  it("TC-note-240: a viewer of the target workspace is refused with InsufficientRole", async () => {
    const h = createTestHarness();
    await seedTarget(h, "viewer");
    const noteId = await createNote(h);

    await expectBusinessRule(
      move(h, { noteId, workspaceId: TARGET_WS }),
      WorkspaceErrorCode.InsufficientRole,
    );

    // The refusal lands before any saga state is created.
    expect(operations(h)).toHaveLength(0);
    expect(notesIn(h, targetScope)).toHaveLength(0);
    expect(await routeOf(h, noteId)).toMatchObject({
      state: "active",
      scope: personalScope,
      routeVersion: 1,
    });
  });

  it("TC-note-241: a viewer of the source workspace gets NOTE_NOT_FOUND, not a permission error", async () => {
    const h = createTestHarness();
    await seedSource(h, "viewer");
    const noteId = await createNote(h, {
      workspaceId: SOURCE_WS,
      userId: BOSS,
    });

    await expectNotFound(move(h, { noteId }), "NOTE_NOT_FOUND");

    expect(notesIn(h, sourceWsScope)).toHaveLength(1);
    expect(operations(h)).toHaveLength(0);
  });

  it("TC-note-242: an unknown target workspace answers WORKSPACE_NOT_FOUND rather than hiding behind the note", async () => {
    const h = createTestHarness();
    await seedTarget(h, "editor");
    const noteId = await createNote(h);

    await expectNotFound(
      move(h, { noteId, workspaceId: "workspace-gone" }),
      "WORKSPACE_NOT_FOUND",
    );
    expect(operations(h)).toHaveLength(0);
  });

  it("TC-note-243: a note whose body is still converting refuses with CannotMoveWhileProcessing", async () => {
    const h = createTestHarness();
    await seedTarget(h, "editor");
    const noteId = await createNote(h);
    await markProcessing(h, personalScope, noteId);

    await expectBusinessRule(
      move(h, { noteId, workspaceId: TARGET_WS, expectedVersion: 1 }),
      NoteErrorCode.CannotMoveWhileProcessing,
    );

    expect(notesIn(h, targetScope)).toHaveLength(0);
    expect(operations(h)).toHaveLength(0);
    expect(await routeOf(h, noteId)).toMatchObject({ state: "active" });
  });

  it("TC-note-244: naming the owner the note already has succeeds with no write and no event", async () => {
    const h = createTestHarness();
    const noteId = await createNote(h);

    const view = await move(h, { noteId });

    expect(view).toEqual({
      noteId,
      ownerType: "user",
      ownerId: ACTOR,
      droppedTagNames: [],
      version: 0,
    });
    expect(outboxRows(h, "note.moved")).toHaveLength(0);
    expect(operations(h)).toHaveLength(0);
    expect(await routeOf(h, noteId)).toMatchObject({
      state: "active",
      routeVersion: 1,
    });
    expect(notesIn(h, personalScope)[0]?.version).toBe(Version.initial());
  });

  it("TC-note-245: an unlisted note keeps its share URL and stays reachable from the new owner", async () => {
    const h = createTestHarness();
    await seedTarget(h, "editor");
    const noteId = await createNote(h);
    const token = await makeUnlisted(h, personalScope, noteId);
    const before = await read(h, noteId);

    await move(h, { noteId, workspaceId: TARGET_WS, expectedVersion: 1 });
    const after = await read(h, noteId);

    expect(before.shareUrl).toBe(`${h.config.appUrl}/s/${token}`);
    expect(after.shareUrl).toBe(before.shareUrl);
    expect(after.visibility).toBe("unlisted");
    expect(after).toMatchObject({ ownerType: "workspace", ownerId: TARGET_WS });
    // The token hash the shared-link read path compares is untouched.
    const moved = notesIn(h, targetScope)[0];
    expect(moved?.visibility.status).toBe("unlisted");
    expect(
      moved?.visibility.status === "unlisted"
        ? moved.visibility.shareLink.tokenHash
        : null,
    ).toBe(h.container.secureTokenGenerator.hashOf(token));
  });

  it("TC-note-248: stored files change owner with the note and the consumption moves with them", async () => {
    const h = createTestHarness();
    await seedTarget(h, "editor");
    const noteId = await createNote(h);
    await seedFile(h, personalScope, StorageOwner.user(actorId), {
      id: "file-source",
      noteId,
      purpose: "source",
      size: 300,
    });
    await seedFile(h, personalScope, StorageOwner.user(actorId), {
      id: "file-media",
      noteId,
      purpose: "media",
      size: 700,
    });
    await seedQuota(h, personalScope, StorageOwner.user(actorId), {
      bytes: 1000,
      notes: 1,
    });

    await move(h, { noteId, workspaceId: TARGET_WS });

    const moved = [...filesIn(h, targetScope)].sort((a, b) =>
      a.id < b.id ? -1 : 1,
    );
    expect(moved.map((file) => file.id)).toEqual(["file-media", "file-source"]);
    for (const file of moved) {
      expect(file.owner).toEqual({ type: "workspace", workspaceId: TARGET_WS });
      // The R2 object never moves, so the key still names the old owner.
      expect(file.objectKey).toContain(`users/${ACTOR}/`);
    }
    expect(filesIn(h, personalScope)).toHaveLength(0);
    expect(quotaOf(h, personalScope)).toMatchObject({
      consumedBytes: 0,
      noteCount: 0,
    });
    expect(quotaOf(h, targetScope)).toMatchObject({
      consumedBytes: 1000,
      noteCount: 1,
    });
  });

  it("TC-note-249: note, revisions, file metadata and the usage delta land in the target scope as one migration", async () => {
    const h = createTestHarness();
    await seedTarget(h, "editor");
    const noteId = await createNote(h);
    await seedRevision(h, personalScope, noteId, "revision-1");
    await seedRevision(h, personalScope, noteId, "revision-2");
    await seedFile(h, personalScope, StorageOwner.user(actorId), {
      id: "file-source",
      noteId,
      purpose: "source",
      size: 40,
    });
    await seedQuota(h, personalScope, StorageOwner.user(actorId), {
      bytes: 40,
      notes: 1,
    });

    await move(h, { noteId, workspaceId: TARGET_WS });

    expect(notesIn(h, targetScope)).toHaveLength(1);
    expect(
      [...revisionsIn(h, targetScope)].map((revision) => revision.id).sort(),
    ).toEqual(["revision-1", "revision-2"]);
    expect(filesIn(h, targetScope)).toHaveLength(1);
    expect(quotaOf(h, targetScope)).toMatchObject({
      consumedBytes: 40,
      noteCount: 1,
    });
    // The target scope's projection generation is prepared in the same
    // transaction, so the read model is built in the new owner's scope.
    expect(h.backend.scope(targetScope).projectionRevisions.get(noteId)).toBe(
      1,
    );

    // Nothing of the note is left behind in the source scope.
    expect(notesIn(h, personalScope)).toHaveLength(0);
    expect(revisionsIn(h, personalScope)).toHaveLength(0);
    expect(filesIn(h, personalScope)).toHaveLength(0);
    expect(quotaOf(h, personalScope)).toMatchObject({
      consumedBytes: 0,
      noteCount: 0,
    });
  });

  it("TC-note-250: a target already over its storage quota still accepts the move", async () => {
    const h = createTestHarness();
    await seedTarget(h, "editor");
    const workspaceOwner = StorageOwner.workspace(
      WorkspaceId.create(TARGET_WS),
    );
    const limit = StorageQuota.initialize(
      QuotaSubject.fromStorageOwner(workspaceOwner),
      h.clock.now(),
    ).quota.limit;
    await seedQuota(h, targetScope, workspaceOwner, {
      bytes: limit + 1,
      notes: 3,
    });
    const noteId = await createNote(h);
    await seedFile(h, personalScope, StorageOwner.user(actorId), {
      id: "file-source",
      noteId,
      purpose: "source",
      size: 500,
    });

    const view = await move(h, { noteId, workspaceId: TARGET_WS });

    expect(view.ownerId).toBe(TARGET_WS);
    // The move applies the delta without ever consulting the limit.
    expect(quotaOf(h, targetScope)).toMatchObject({
      consumedBytes: limit + 501,
      noteCount: 4,
    });
  });

  it("TC-note-251: a move that pushes the target past its quota succeeds and only blocks later uploads", async () => {
    const h = createTestHarness();
    await seedTarget(h, "editor");
    const workspaceOwner = StorageOwner.workspace(
      WorkspaceId.create(TARGET_WS),
    );
    const limit = StorageQuota.initialize(
      QuotaSubject.fromStorageOwner(workspaceOwner),
      h.clock.now(),
    ).quota.limit;
    await seedQuota(h, targetScope, workspaceOwner, {
      bytes: limit - 100,
      notes: 1,
    });
    const noteId = await createNote(h);
    await seedFile(h, personalScope, StorageOwner.user(actorId), {
      id: "file-source",
      noteId,
      purpose: "source",
      size: 400,
    });
    await seedQuota(h, personalScope, StorageOwner.user(actorId), {
      bytes: 400,
      notes: 1,
    });

    await move(h, { noteId, workspaceId: TARGET_WS });

    const quota = quotaOf(h, targetScope);
    expect(quota?.consumedBytes).toBe(limit + 300);
    expect(quota?.consumedBytes).toBeGreaterThan(limit);
    expect(notesIn(h, targetScope)).toHaveLength(1);
  });

  it("TC-note-252: an actor removed from the source workspace before the freeze commits gets NOTE_NOT_FOUND", async () => {
    const h = createTestHarness();
    await seedSource(h, "editor");
    const noteId = await createNote(h, { workspaceId: SOURCE_WS });
    const container = withScopeRunHooks(h, {
      before: async (_scope, index) => {
        if (index === 0) {
          await dropMembership(h, SOURCE_WS, ACTOR);
        }
      },
    });

    await expectNotFound(move(h, { noteId, container }), "NOTE_NOT_FOUND");

    // The route thawed back to the source and nothing was staged.
    expect(await routeOf(h, noteId)).toMatchObject({
      state: "active",
      scope: sourceWsScope,
      routeVersion: 1,
    });
    expect(notesIn(h, personalScope)).toHaveLength(0);
    expect(moveLocksIn(h, sourceWsScope)).toHaveLength(0);
  });

  it("TC-note-253: an actor removed from the target workspace before the staging commits gets InsufficientRole", async () => {
    const h = createTestHarness();
    await seedTarget(h, "editor");
    const noteId = await createNote(h);
    const container = withScopeRunHooks(h, {
      before: async (_scope, index) => {
        if (index === 1) {
          await dropMembership(h, TARGET_WS, ACTOR);
        }
      },
    });

    await expectBusinessRule(
      move(h, { noteId, workspaceId: TARGET_WS, container }),
      WorkspaceErrorCode.InsufficientRole,
    );

    expect(notesIn(h, targetScope)).toHaveLength(0);
    expect(notesIn(h, personalScope)).toHaveLength(1);
    expect(await routeOf(h, noteId)).toMatchObject({
      state: "active",
      scope: personalScope,
    });
    expect(moveLocksIn(h, targetScope)).toHaveLength(0);
  });

  it("TC-note-254: a source membership version that moved between the pre-flight and the freeze aborts the move", async () => {
    const h = createTestHarness();
    await seedSource(h, "editor");
    const noteId = await createNote(h, { workspaceId: SOURCE_WS });
    const container = withScopeRunHooks(h, {
      before: async (_scope, index) => {
        if (index === 0) {
          await demoteMembership(h, SOURCE_WS, ACTOR);
        }
      },
    });

    await expectConflict(move(h, { noteId, container }), "STALE_MEMBERSHIP");

    expect(await routeOf(h, noteId)).toMatchObject({
      state: "active",
      scope: sourceWsScope,
    });
    expect(notesIn(h, sourceWsScope)).toHaveLength(1);
    expect(notesIn(h, personalScope)).toHaveLength(0);
  });

  it("TC-note-255: demoting or removing the actor is refused while the target staging stands, and allowed once it activates", async () => {
    const h = createTestHarness();
    await seedTarget(h, "editor");
    const noteId = await createNote(h);
    let locksWhileStaged = 0;
    const container = withScopeRunHooks(h, {
      after: async (_scope, index) => {
        if (index !== 1) {
          return;
        }
        locksWhileStaged = moveLocksIn(h, targetScope).length;
        await expectConflict(
          changeMemberRole({
            container: h.container,
            input: {
              workspaceId: TARGET_WS,
              actorUserId: BOSS,
              membershipId: "membership-actor",
              role: "viewer",
            },
          }),
          "WORKSPACE_MOVE_IN_PROGRESS",
        );
        await expectConflict(
          removeMember({
            container: h.container,
            input: {
              workspaceId: TARGET_WS,
              actorUserId: BOSS,
              membershipId: "membership-actor",
            },
          }),
          "WORKSPACE_MOVE_IN_PROGRESS",
        );
      },
    });

    await move(h, { noteId, workspaceId: TARGET_WS, container });

    expect(locksWhileStaged).toBe(1);
    expect(moveLocksIn(h, targetScope)).toHaveLength(0);
    const changed = await changeMemberRole({
      container: h.container,
      input: {
        workspaceId: TARGET_WS,
        actorUserId: BOSS,
        membershipId: "membership-actor",
        role: "viewer",
      },
    });
    expect(changed).toEqual({
      membershipId: "membership-actor",
      role: "viewer",
    });
  });

  it("TC-note-255: an aborted move releases the actor's lock in both scopes", async () => {
    const h = createTestHarness();
    await seedTarget(h, "editor");
    const noteId = await createNote(h);
    const container = withRouteStore(h, {
      switchMove: () => Promise.reject(failure("switch failed")),
    });

    await expect(
      move(h, { noteId, workspaceId: TARGET_WS, container }),
    ).rejects.toThrow("switch failed");

    expect(moveLocksIn(h, targetScope)).toHaveLength(0);
    expect(moveLocksIn(h, personalScope)).toHaveLength(0);
    const changed = await changeMemberRole({
      container: h.container,
      input: {
        workspaceId: TARGET_WS,
        actorUserId: BOSS,
        membershipId: "membership-actor",
        role: "viewer",
      },
    });
    expect(changed.role).toBe("viewer");
  });

  it("TC-note-256: a workspace note moved to a personal scope disappears for the other members", async () => {
    const h = createTestHarness();
    await seedSource(h, "editor", [OTHER]);
    const noteId = await createNote(h, { workspaceId: SOURCE_WS });

    await move(h, { noteId });

    await expectNotFound(read(h, noteId, OTHER), "NOTE_NOT_FOUND");
    expect(await read(h, noteId)).toMatchObject({
      ownerType: "user",
      ownerId: ACTOR,
    });
  });

  it("TC-note-257: a stale expectedVersion is answered with OPTIMISTIC_LOCK_FAILURE", async () => {
    const h = createTestHarness();
    await seedTarget(h, "editor");
    const noteId = await createNote(h);
    // Somebody else saved the note first.
    await h.container.scopeUnitOfWorkProvider.run(
      personalScope,
      async (ctx) => {
        const stored = await ctx.noteRepository.findById(NoteId.create(noteId));
        if (stored === null || !Note.isActive(stored.entity)) {
          throw new Error("seed missing");
        }
        const renamed = Note.rename(stored.entity, "先に更新", h.clock.now());
        await ctx.noteRepository.save(renamed.entity, stored.expectedVersion);
      },
    );

    await expectConflict(
      move(h, { noteId, workspaceId: TARGET_WS, expectedVersion: 0 }),
      "OPTIMISTIC_LOCK_FAILURE",
    );
    expect(notesIn(h, targetScope)).toHaveLength(0);
    expect(operations(h)).toHaveLength(0);
  });

  it("TC-note-258: a failure right after the freeze resumes on the same migration id without a duplicate target note", async () => {
    const h = createTestHarness();
    await seedTarget(h, "editor");
    const noteId = await createNote(h);
    let stageAttempted = false;
    const container = withScopeRunHooks(h, {
      before: (_scope, index) => {
        if (index === 1 && !stageAttempted) {
          stageAttempted = true;
          throw failure("staging response lost");
        }
      },
    });

    await expect(
      move(h, { noteId, workspaceId: TARGET_WS, container }),
    ).rejects.toThrow("staging response lost");
    expect(operations(h)).toHaveLength(1);
    const migrationId = operations(h)[0]?.id;

    const view = await move(h, { noteId, workspaceId: TARGET_WS });

    expect(view.ownerId).toBe(TARGET_WS);
    // The same operation was replayed, not a second one.
    expect(operations(h)).toHaveLength(1);
    expect(operations(h)[0]).toMatchObject({
      id: migrationId,
      state: "completed",
    });
    expect(notesIn(h, targetScope)).toHaveLength(1);
    expect(notesIn(h, personalScope)).toHaveLength(0);
    expect(outboxRows(h, "note.moved")).toHaveLength(1);
  });

  it("TC-note-258: a re-request after an abort that already staged must not lose the note", async () => {
    const h = createTestHarness();
    await seedTarget(h, "editor");
    const noteId = await createNote(h);
    let switchAttempted = false;
    const container = withRouteStore(h, {
      switchMove: (input) => {
        if (!switchAttempted) {
          switchAttempted = true;
          return Promise.reject(failure("switch failed"));
        }
        return h.container.noteRouteStore.switchMove(input);
      },
    });

    await expect(
      move(h, { noteId, workspaceId: TARGET_WS, container }),
    ).rejects.toThrow("switch failed");
    expect(notesIn(h, targetScope)).toHaveLength(0);
    expect(notesIn(h, personalScope)).toHaveLength(1);

    await move(h, { noteId, workspaceId: TARGET_WS });

    // Whatever the resume decides, exactly one copy of the note must
    // survive it — the abort consumed the staging guard, not the note.
    expect([
      ...notesIn(h, targetScope),
      ...notesIn(h, personalScope),
    ]).toHaveLength(1);
    expect(notesIn(h, targetScope)).toHaveLength(1);
  });

  it("TC-note-259: while the target is staged the route still names the source, and the abort clears the staged copy", async () => {
    const h = createTestHarness();
    await seedTarget(h, "editor");
    const noteId = await createNote(h);
    let staged: Readonly<{
      routeScope: ScopeKey;
      routeState: string;
      targetNotes: number;
      visibleOwner: string;
    }> | null = null;
    const container = withRouteStore(h, {
      switchMove: async () => {
        const route = await routeOf(h, noteId);
        const visible = await read(h, noteId);
        staged = {
          routeScope: route?.scope ?? personalScope,
          routeState: route?.state ?? "missing",
          targetNotes: notesIn(h, targetScope).length,
          visibleOwner: visible.ownerId,
        };
        throw failure("switch failed");
      },
    });

    await expect(
      move(h, { noteId, workspaceId: TARGET_WS, container }),
    ).rejects.toThrow("switch failed");

    expect(staged).toEqual({
      routeScope: personalScope,
      routeState: "moving",
      targetNotes: 1,
      visibleOwner: ACTOR,
    });
    expect(notesIn(h, targetScope)).toHaveLength(0);
    expect(await routeOf(h, noteId)).toMatchObject({
      state: "active",
      scope: personalScope,
      routeVersion: 1,
    });
  });

  it("TC-note-260: an abort before the switch reverses the credit, the staging, both locks and the route", async () => {
    const h = createTestHarness();
    await seedTarget(h, "editor");
    const noteId = await createNote(h);
    await seedRevision(h, personalScope, noteId, "revision-1");
    await seedFile(h, personalScope, StorageOwner.user(actorId), {
      id: "file-source",
      noteId,
      purpose: "source",
      size: 120,
    });
    await seedQuota(h, personalScope, StorageOwner.user(actorId), {
      bytes: 120,
      notes: 1,
    });
    const container = withRouteStore(h, {
      switchMove: () => Promise.reject(failure("switch failed")),
    });

    await expect(
      move(h, { noteId, workspaceId: TARGET_WS, container }),
    ).rejects.toThrow("switch failed");

    // The target is back to holding nothing at all.
    expect(notesIn(h, targetScope)).toHaveLength(0);
    expect(revisionsIn(h, targetScope)).toHaveLength(0);
    expect(filesIn(h, targetScope)).toHaveLength(0);
    expect(quotaOf(h, targetScope)).toMatchObject({
      consumedBytes: 0,
      noteCount: 0,
    });
    expect(moveLocksIn(h, targetScope)).toHaveLength(0);
    expect(moveLocksIn(h, personalScope)).toHaveLength(0);
    expect(await routeOf(h, noteId)).toMatchObject({
      state: "active",
      scope: personalScope,
      routeVersion: 1,
    });
    // The source never lost anything.
    expect(notesIn(h, personalScope)).toHaveLength(1);
    expect(filesIn(h, personalScope)).toHaveLength(1);
    expect(quotaOf(h, personalScope)).toMatchObject({
      consumedBytes: 120,
      noteCount: 1,
    });
    expect(outboxRows(h, "note.moved")).toHaveLength(0);
  });

  it("TC-note-261: a lost abortMove response still leaves the note on an active source with no double credit or debit", async () => {
    const h = createTestHarness();
    await seedTarget(h, "editor");
    const noteId = await createNote(h);
    await seedFile(h, personalScope, StorageOwner.user(actorId), {
      id: "file-source",
      noteId,
      purpose: "source",
      size: 90,
    });
    await seedQuota(h, personalScope, StorageOwner.user(actorId), {
      bytes: 90,
      notes: 1,
    });
    let abortResponseLost = false;
    const container = withRouteStore(h, {
      switchMove: () => Promise.reject(failure("switch failed")),
      abortMove: async (input) => {
        const route = await h.container.noteRouteStore.abortMove(input);
        if (!abortResponseLost) {
          abortResponseLost = true;
          throw failure("abort response lost");
        }
        return route;
      },
    });

    // The caller still sees the original cause, not the rollback's.
    await expect(
      move(h, { noteId, workspaceId: TARGET_WS, container }),
    ).rejects.toThrow("switch failed");
    expect(abortResponseLost).toBe(true);
    expect(h.logger.byLevel("error").map((entry) => entry.message)).toContain(
      "[moveNote] rollback failed before route switch",
    );

    expect(await routeOf(h, noteId)).toMatchObject({
      state: "active",
      scope: personalScope,
      routeVersion: 1,
    });
    // Credit reversed exactly once; the source was never debited.
    expect(quotaOf(h, targetScope)).toMatchObject({
      consumedBytes: 0,
      noteCount: 0,
    });
    expect(quotaOf(h, personalScope)).toMatchObject({
      consumedBytes: 90,
      noteCount: 1,
    });
    expect(filesIn(h, targetScope)).toHaveLength(0);
    expect(filesIn(h, personalScope)).toHaveLength(1);
  });

  it("TC-note-262: deleting the target workspace is refused while the move is staged and accepted once it settles", async () => {
    const h = createTestHarness();
    await seedTarget(h, "editor");
    const noteId = await createNote(h);
    const deleteTarget = () =>
      deleteWorkspace({
        container: h.container,
        input: {
          workspaceId: TARGET_WS,
          userId: BOSS,
          confirmationName: WORKSPACE_NAME,
        },
      });
    const container = withScopeRunHooks(h, {
      after: async (_scope, index) => {
        if (index === 1) {
          await expectConflict(deleteTarget(), "WORKSPACE_MOVE_IN_PROGRESS");
        }
      },
    });

    await move(h, { noteId, workspaceId: TARGET_WS, container });

    const accepted = await deleteTarget();
    expect(accepted.status).toBe("accepted");
  });

  it("TC-note-263: a failure after the route switch does not abort — the target keeps the note and the route", async () => {
    const h = createTestHarness();
    await seedTarget(h, "editor");
    const noteId = await createNote(h);
    await seedQuota(h, personalScope, StorageOwner.user(actorId), {
      bytes: 0,
      notes: 1,
    });
    const container = withScopeRunHooks(h, {
      before: (_scope, index) => {
        if (index === 3) {
          throw failure("retire failed");
        }
      },
    });

    await expect(
      move(h, { noteId, workspaceId: TARGET_WS, container }),
    ).rejects.toThrow("retire failed");

    expect(await routeOf(h, noteId)).toMatchObject({
      state: "active",
      scope: targetScope,
      routeVersion: 2,
    });
    expect(notesIn(h, targetScope)).toHaveLength(1);
    expect(quotaOf(h, targetScope)).toMatchObject({ noteCount: 1 });
    // Activation ran, so the target's lock is already released; the
    // source's stands until the retire it guards finally lands.
    expect(moveLocksIn(h, targetScope)).toHaveLength(0);
    expect(moveLocksIn(h, personalScope)).toHaveLength(1);
    // Forward-only: the source rows are still there, awaiting the retry.
    expect(notesIn(h, personalScope)).toHaveLength(1);
    expect(await read(h, noteId)).toMatchObject({
      ownerType: "workspace",
      ownerId: TARGET_WS,
    });
  });

  it("TC-note-264: stopping between the target credit and the switch double-counts rather than under-counts", async () => {
    const h = createTestHarness();
    await seedTarget(h, "editor");
    const noteId = await createNote(h);
    await seedFile(h, personalScope, StorageOwner.user(actorId), {
      id: "file-source",
      noteId,
      purpose: "source",
      size: 250,
    });
    await seedQuota(h, personalScope, StorageOwner.user(actorId), {
      bytes: 250,
      notes: 1,
    });
    const midFlight: Readonly<{
      source: StorageQuota | undefined;
      target: StorageQuota | undefined;
    }>[] = [];
    const container = withRouteStore(h, {
      switchMove: () => {
        midFlight.push({
          source: quotaOf(h, personalScope),
          target: quotaOf(h, targetScope),
        });
        return Promise.reject(failure("stopped before the switch"));
      },
    });

    await expect(
      move(h, { noteId, workspaceId: TARGET_WS, container }),
    ).rejects.toThrow("stopped before the switch");

    // The source is still charged in full, so free space is never
    // over-estimated; the target is charged too, which is the safe side.
    expect(midFlight).toHaveLength(1);
    expect(midFlight[0]?.source).toMatchObject({
      consumedBytes: 250,
      noteCount: 1,
    });
    expect(midFlight[0]?.target).toMatchObject({
      consumedBytes: 250,
      noteCount: 1,
    });
  });

  it("TC-note-265: stopping between the switch and the source debit leaves the source over-counted and never debits twice", async () => {
    const h = createTestHarness();
    await seedTarget(h, "editor");
    const noteId = await createNote(h);
    await seedFile(h, personalScope, StorageOwner.user(actorId), {
      id: "file-source",
      noteId,
      purpose: "source",
      size: 80,
    });
    await seedQuota(h, personalScope, StorageOwner.user(actorId), {
      bytes: 80,
      notes: 1,
    });
    const container = withScopeRunHooks(h, {
      before: (_scope, index) => {
        if (index === 3) {
          throw failure("stopped before the source debit");
        }
      },
    });

    await expect(
      move(h, { noteId, workspaceId: TARGET_WS, container }),
    ).rejects.toThrow("stopped before the source debit");

    expect(await routeOf(h, noteId)).toMatchObject({ scope: targetScope });
    expect(quotaOf(h, targetScope)).toMatchObject({
      consumedBytes: 80,
      noteCount: 1,
    });
    expect(quotaOf(h, personalScope)).toMatchObject({
      consumedBytes: 80,
      noteCount: 1,
    });

    // Re-requesting the settled move credits nothing a second time.
    await move(h, { noteId, workspaceId: TARGET_WS });
    expect(quotaOf(h, targetScope)).toMatchObject({
      consumedBytes: 80,
      noteCount: 1,
    });
    expect(quotaOf(h, personalScope)).toMatchObject({
      consumedBytes: 80,
      noteCount: 1,
    });
  });

  it("TC-note-266: a lost switchMove response does not switch the route a second time when the request is repeated", async () => {
    const h = createTestHarness();
    await seedTarget(h, "editor");
    const noteId = await createNote(h);
    let switched = false;
    // The switch commits and the process dies before anything else runs,
    // which is what makes the response "lost" rather than a failure the
    // rollback may answer.
    const crashed: RequestContainer = {
      ...h.container,
      noteRouteStore: {
        ...h.container.noteRouteStore,
        switchMove: async (input) => {
          await h.container.noteRouteStore.switchMove(input);
          switched = true;
          throw failure("switch response lost");
        },
      },
      scopeUnitOfWorkProvider: {
        run: <T>(
          scope: ScopeKey,
          fn: (ctx: ScopeUnitOfWorkContext) => Promise<T>,
        ): Promise<T> =>
          switched
            ? Promise.reject(failure("process died"))
            : h.container.scopeUnitOfWorkProvider.run(scope, fn),
      },
    };

    await expect(
      move(h, { noteId, workspaceId: TARGET_WS, container: crashed }),
    ).rejects.toThrow("switch response lost");
    expect(await routeOf(h, noteId)).toMatchObject({
      scope: targetScope,
      routeVersion: 2,
    });

    const view = await move(h, { noteId, workspaceId: TARGET_WS });

    expect(view).toMatchObject({ ownerType: "workspace", ownerId: TARGET_WS });
    // The repeat reads the route, sees the switch already landed, and
    // does not apply a second one.
    expect(await routeOf(h, noteId)).toMatchObject({
      state: "active",
      scope: targetScope,
      routeVersion: 2,
    });
    expect(notesIn(h, targetScope)).toHaveLength(1);
    expect(operations(h)).toHaveLength(1);
  });

  it("TC-note-267: after the switch the current route reaches the target and a delayed source write is refused", async () => {
    const h = createTestHarness();
    await seedTarget(h, "editor");
    const noteId = await createNote(h);
    const container = withScopeRunHooks(h, {
      before: (_scope, index) => {
        if (index === 3) {
          throw failure("source tombstone pending");
        }
      },
    });

    await expect(
      move(h, { noteId, workspaceId: TARGET_WS, container }),
    ).rejects.toThrow("source tombstone pending");

    // The source row is still there but nothing routes to it any more.
    expect(notesIn(h, personalScope)).toHaveLength(1);
    expect(await read(h, noteId)).toMatchObject({
      ownerType: "workspace",
      ownerId: TARGET_WS,
    });
    // A writer that still holds the pre-switch route version is refused.
    await expectConflict(
      h.container.noteRouteStore.beginMove({
        noteId: NoteId.create(noteId),
        expectedRouteVersion: 1,
        target: personalScope,
        migrationId: "late-migration",
      }),
      "STALE_SCOPE_ROUTE",
    );
  });

  it("TC-note-268: a public projection event issued before the move cannot overwrite the target owner's row", async () => {
    const h = createTestHarness();
    await seedTarget(h, "editor");
    const noteId = await createNote(h);

    await move(h, { noteId, workspaceId: TARGET_WS });
    const movedPayload = outboxRows(h, "note.moved")[0]?.payload as
      | Readonly<{ routeVersion: number }>
      | undefined;
    const routeVersion = movedPayload?.routeVersion ?? 0;
    expect(routeVersion).toBe(2);
    const writer = h.workerContainer.publicNoteProjectionWriter;
    const entryFor = (owner: "user" | "workspace") => ({
      noteId: NoteId.create(noteId),
      owner:
        owner === "user"
          ? ({ type: "user", userId: actorId } as const)
          : ({
              type: "workspace",
              workspaceId: WorkspaceId.create(TARGET_WS),
            } as const),
      createdBy: actorId,
      author: { displayName: ACTOR, handle: null, version: 0 },
      workspace:
        owner === "workspace"
          ? { name: WORKSPACE_NAME, slug: null, published: false, version: 0 }
          : null,
      title: "移動するノート",
      text: "",
      excerpt: "",
      visibility: "public" as const,
      contentStatus: "ready" as const,
      styleMode: "default" as const,
      hasSourceFile: false,
      lifecycle: "active" as const,
      createdAt: h.clock.now(),
      updatedAt: h.clock.now(),
      trashedAt: null,
      purgeAfter: null,
    });

    // The consumer that read the current route publishes the new owner.
    const fresh = await writer.replaceSnapshotIfNewer(
      entryFor("workspace"),
      [],
      {
        routeVersion,
        projectionRevision: 1,
        authorVersion: 0,
        workspaceVersion: 0,
      },
    );
    // A pre-move event arrives late carrying the previous generation.
    const late = await writer.replaceSnapshotIfNewer(entryFor("user"), [], {
      routeVersion: routeVersion - 1,
      projectionRevision: 99,
      authorVersion: 99,
      workspaceVersion: 99,
    });

    expect(fresh).toBe("written");
    expect(late).toBe("stale");
    expect(h.backend.publicProjection.get(noteId)?.entry.owner).toEqual({
      type: "workspace",
      workspaceId: TARGET_WS,
    });
  });

  it("TC-note-269: a failing source cleanup keeps the route on the target and never gives the note back to the source", async () => {
    const h = createTestHarness();
    await seedTarget(h, "editor");
    const noteId = await createNote(h);
    const container = withScopeRunHooks(h, {
      before: (_scope, index) => {
        if (index === 3) {
          throw failure("source cleanup failed");
        }
      },
    });

    await expect(
      move(h, { noteId, workspaceId: TARGET_WS, container }),
    ).rejects.toThrow("source cleanup failed");
    expect(await routeOf(h, noteId)).toMatchObject({ scope: targetScope });

    // Retrying the request must not walk the ownership back to the source.
    const view = await move(h, { noteId, workspaceId: TARGET_WS });

    expect(view).toMatchObject({ ownerType: "workspace", ownerId: TARGET_WS });
    expect(await routeOf(h, noteId)).toMatchObject({
      state: "active",
      scope: targetScope,
      routeVersion: 2,
    });
    expect(await read(h, noteId)).toMatchObject({ ownerId: TARGET_WS });
  });
});
