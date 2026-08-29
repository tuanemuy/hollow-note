import { Version } from "@repo/core/domain/common/version";
import { UserId } from "@repo/core/domain/identity/valueObject";
import { NoteErrorCode } from "@repo/core/domain/note/errorCode";
import { type ActiveNote, Note } from "@repo/core/domain/note/note";
import { NoteRevision } from "@repo/core/domain/note/noteRevision";
import {
  NoteId,
  NoteOwner,
  ShareLink,
} from "@repo/core/domain/note/valueObject";
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
import type { RequestContainer, WorkspaceReader } from "../../di/types";
import { SystemError, SystemErrorCode } from "../../errors";
import type {
  GlobalUnitOfWorkContext,
  ScopeUnitOfWorkContext,
} from "../../execution/unitOfWork";
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
import {
  type MovedNoteView,
  moveNote,
  type NoteMoveTagRelocation,
} from "../moveNote";

const ACTOR = "user-1";
const BOSS = "owner-1";
const OTHER = "user-2";
const TARGET_WS = "workspace-target";
const SOURCE_WS = "workspace-source";
/** `WorkspaceSeed` names the workspace "Workspace" unless told otherwise. */
const WORKSPACE_NAME = "Workspace";

const actorId = UserId.create(ACTOR);
const otherId = UserId.create(OTHER);
const personalScope = ScopeKey.user(actorId);
const otherPersonalScope = ScopeKey.user(otherId);
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
      title: "移動するノート",
      ...(owner.workspaceId === undefined
        ? { ownerType: "user" as const }
        : {
            ownerType: "workspace" as const,
            ownerWorkspaceId: owner.workspaceId,
          }),
    },
  });
  return view.noteId;
};

type MoveInput = Readonly<{
  noteId: string;
  workspaceId?: string;
  userId?: string;
  /** `null` is the transport's own shape: a caller with no version. */
  expectedVersion?: number | null;
  container?: RequestContainer;
  tagRelocation?: NoteMoveTagRelocation;
}>;

const move = (h: TestHarness, input: MoveInput): Promise<MovedNoteView> =>
  moveNote({
    container: input.container ?? h.container,
    input: {
      noteId: input.noteId,
      userId: input.userId ?? ACTOR,
      expectedVersion:
        input.expectedVersion === undefined ? 0 : input.expectedVersion,
      ...(input.workspaceId === undefined
        ? { targetOwnerType: "user" as const }
        : {
            targetOwnerType: "workspace" as const,
            targetWorkspaceId: input.workspaceId,
          }),
    },
    ...(input.tagRelocation === undefined
      ? {}
      : { tagRelocation: input.tagRelocation }),
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

/** A scope that was never charged has no row, which reads as zero. */
const quotaTotals = (
  h: TestHarness,
  scope: ScopeKey,
): Readonly<{ consumedBytes: number; noteCount: number }> => {
  const quota = quotaOf(h, scope);
  return {
    consumedBytes: quota?.consumedBytes ?? 0,
    noteCount: quota?.noteCount ?? 0,
  };
};

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

/** Drops a note row the way a half-applied retire would leave the scope. */
async function deleteNoteRow(
  h: TestHarness,
  scope: ScopeKey,
  noteId: string,
): Promise<void> {
  await h.container.scopeUnitOfWorkProvider.run(scope, async (ctx) => {
    const id = NoteId.create(noteId);
    const stored = await ctx.noteRepository.findById(id);
    if (stored === null) {
      throw new Error(`no note ${noteId}`);
    }
    await ctx.noteRepository.delete(id, stored.expectedVersion);
  });
}

/** Edits a note in place; the editing usecases land with Issue #6 / #7. */
async function renameNoteRow(
  h: TestHarness,
  scope: ScopeKey,
  noteId: string,
  title: string,
): Promise<void> {
  await h.container.scopeUnitOfWorkProvider.run(scope, async (ctx) => {
    const stored = await ctx.noteRepository.findById(NoteId.create(noteId));
    if (stored === null || !Note.isActive(stored.entity)) {
      throw new Error(`no active note ${noteId}`);
    }
    const renamed = Note.rename(stored.entity, title, h.clock.now());
    await ctx.noteRepository.save(renamed.entity, stored.expectedVersion);
  });
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

/**
 * A container that lets a test commit something the instant a membership
 * is read outside a transaction. That is the window the pre-flight has to
 * close: a role observed by one read and a version taken by another leave
 * the commit-time re-check comparing the *new* version against itself.
 */
const withMembershipReadHook = (
  h: TestHarness,
  onRead: (scope: ScopeKey, role: string) => Promise<void> | void,
): RequestContainer => ({
  ...h.container,
  workspaceReaderFor: (scope: ScopeKey): WorkspaceReader => {
    const reader = h.container.workspaceReaderFor(scope);
    return {
      ...reader,
      membership: {
        ...reader.membership,
        findByWorkspaceAndUser: async (workspaceId, userId) => {
          const found = await reader.membership.findByWorkspaceAndUser(
            workspaceId,
            userId,
          );
          if (found !== null) {
            await onRead(scope, found.entity.role);
          }
          return found;
        },
      },
    };
  },
});

const TAG_COMMAND = "tag.moveRelocateAssignments";

/**
 * The tag seam as Issue #8 will write it: a receipt of its own in the
 * target scope, declared so an abort clears it with the note's.
 */
const recordingTagRelocation = (stagings: string[]): NoteMoveTagRelocation => ({
  targetScopeCommandKeys: [TAG_COMMAND],
  plan: async () => [],
  stageTarget: async (ctx, input) => {
    if (
      await ctx.appliedOperationStore.markApplied({
        operationId: input.migrationId,
        commandKey: TAG_COMMAND,
      })
    ) {
      stagings.push(input.migrationId);
    }
  },
  retireSource: async () => {},
});

const failure = (detail: string): SystemError =>
  new SystemError(SystemErrorCode.DatabaseError, detail);

/** Every point of the move whose response the caller can lose. */
type MoveSeam =
  | "beginOperation"
  | "claimRoute"
  | "snapshotSource"
  | "stageTarget"
  | "switchMove"
  | "activateTarget"
  | "retireSource"
  | "settle";

/** Scope transactions, by position in the move's fixed sequence. */
const SCOPE_PHASE_OF: Readonly<Partial<Record<MoveSeam, number>>> = {
  snapshotSource: 0,
  stageTarget: 1,
  activateTarget: 2,
  retireSource: 3,
};

/** Global transactions: the operation is opened first and settled last. */
const GLOBAL_PHASE_OF: Readonly<Partial<Record<MoveSeam, number>>> = {
  beginOperation: 0,
  settle: 1,
};

/**
 * A container in which `seam` commits for real and then loses its
 * response, exactly once.
 *
 * The process stays alive, which is the whole point. `TC-note-266` kills
 * it right after the switch, so nothing the saga decides to do about the
 * loss ever runs; here every compensation runs in full, and what it does
 * to a phase that already committed becomes observable.
 */
const withLostResponseAt = (
  h: TestHarness,
  seam: MoveSeam,
): RequestContainer => {
  let lost = false;
  const lose = (): never => {
    lost = true;
    throw failure(`${seam} response lost`);
  };
  let scopeRuns = 0;
  let globalRuns = 0;
  return {
    ...h.container,
    noteRouteStore: {
      ...h.container.noteRouteStore,
      beginMove: async (input) => {
        const route = await h.container.noteRouteStore.beginMove(input);
        return seam === "claimRoute" && !lost ? lose() : route;
      },
      switchMove: async (input) => {
        const route = await h.container.noteRouteStore.switchMove(input);
        return seam === "switchMove" && !lost ? lose() : route;
      },
    },
    globalUnitOfWorkProvider: {
      run: async <T>(
        fn: (ctx: GlobalUnitOfWorkContext) => Promise<T>,
      ): Promise<T> => {
        const index = globalRuns;
        globalRuns += 1;
        const result = await h.container.globalUnitOfWorkProvider.run(fn);
        return !lost && GLOBAL_PHASE_OF[seam] === index ? lose() : result;
      },
    },
    scopeUnitOfWorkProvider: {
      run: async <T>(
        scope: ScopeKey,
        fn: (ctx: ScopeUnitOfWorkContext) => Promise<T>,
      ): Promise<T> => {
        const index = scopeRuns;
        scopeRuns += 1;
        const result = await h.container.scopeUnitOfWorkProvider.run(scope, fn);
        return !lost && SCOPE_PHASE_OF[seam] === index ? lose() : result;
      },
    },
  };
};

type MoveFollowUp =
  | "nothing follows"
  | "the same actor asks again"
  | "another editor asks for the same move";

const runFollowUp = async (
  h: TestHarness,
  follow: MoveFollowUp,
  noteId: string,
): Promise<void> => {
  if (follow === "nothing follows") {
    return;
  }
  // Whether the follow-up succeeds or is refused is not the subject here:
  // the note has to survive either answer.
  await move(h, {
    noteId,
    workspaceId: TARGET_WS,
    userId: follow === "the same actor asks again" ? ACTOR : OTHER,
    expectedVersion: null,
  }).then(
    () => undefined,
    () => undefined,
  );
};

const sourceWsOwner = StorageOwner.workspace(WorkspaceId.create(SOURCE_WS));

/** Two workspaces both editors belong to, so either may ask for the move. */
const seedMovePair = async (h: TestHarness): Promise<void> => {
  for (const workspaceId of [SOURCE_WS, TARGET_WS]) {
    await seedWorkspace(h, {
      workspaceId,
      members: [
        { userId: BOSS, role: "owner" },
        {
          userId: ACTOR,
          role: "editor",
          membershipId: `membership-actor-${workspaceId}`,
        },
        {
          userId: OTHER,
          role: "editor",
          membershipId: `membership-other-${workspaceId}`,
        },
      ],
    });
  }
};

/** What the one file `seedWholeNote` attaches weighs. */
const WHOLE_NOTE_BYTES = 120;

/** A note with everything a move carries: a revision, a file, a charge. */
const seedWholeNote = async (h: TestHarness): Promise<string> => {
  const noteId = await createNote(h, { workspaceId: SOURCE_WS });
  await seedRevision(h, sourceWsScope, noteId, "revision-1");
  await seedFile(h, sourceWsScope, sourceWsOwner, {
    id: "file-source",
    noteId,
    purpose: "source",
    size: WHOLE_NOTE_BYTES,
  });
  await seedQuota(h, sourceWsScope, sourceWsOwner, {
    bytes: WHOLE_NOTE_BYTES,
    notes: 1,
  });
  return noteId;
};

/** The other half of the pair `seedMovePair` sets up. */
const acrossFrom = (scope: ScopeKey): ScopeKey =>
  ScopeKey.equals(scope, targetScope) ? sourceWsScope : targetScope;

const scopeOwnerId = (scope: ScopeKey): string =>
  scope.type === "workspace" ? scope.workspaceId : scope.userId;

/**
 * The invariants no failure may break, over the pair `seedMovePair` sets
 * up. Stated for a move whose every compensation ran to its own end: one
 * injected fault, and whatever the saga decided to do about it completed.
 *
 * The first is the loss this saga must never produce: the scope the route
 * names holds the note whole — its revision and its file with it — and a
 * reader gets there. A copy left behind in the scope the note came from
 * is unreachable and can still be retired later.
 *
 * The other three are conditional on the operation, because what a
 * stopped move may leave behind depends on whether anything can still
 * drive it (spec/usecases/note.md#movenote 手順 4・8):
 *
 * - a move authorization lock carries no lease and no expiry, and only a
 *   caller holding the migration id releases it — once every operation of
 *   this note is terminal no such caller can exist again, so a lock that
 *   outlives them closes both scopes' deletion and membership management
 *   for good;
 * - the charge follows the route, since the two scopes' quotas are moved
 *   by the phases themselves; a stopped move is allowed to double-count
 *   but never to under-count, so mid-flight only the floor is asserted;
 * - a staged copy across from the route is the abort's leftover, and the
 *   spec's 「完全」 is that no trace of this migration stays in the scope
 *   the note did not end up in.
 */
const expectWholeAndReachable = async (
  h: TestHarness,
  noteId: string,
): Promise<void> => {
  const route = await routeOf(h, noteId);
  if (route === null) {
    throw new Error(`the route for ${noteId} is gone`);
  }
  expect(notesIn(h, route.scope)).toHaveLength(1);
  expect(revisionsIn(h, route.scope)).toHaveLength(1);
  expect(filesIn(h, route.scope)).toHaveLength(1);
  expect(await read(h, noteId)).toMatchObject({
    ownerId: scopeOwnerId(route.scope),
  });

  const across = acrossFrom(route.scope);
  const undrivable = operations(h).every((row) => row.state !== "running");
  const charged = quotaTotals(h, route.scope);
  if (!undrivable) {
    expect(charged.consumedBytes).toBeGreaterThanOrEqual(WHOLE_NOTE_BYTES);
    expect(charged.noteCount).toBeGreaterThanOrEqual(1);
    return;
  }

  expect(moveLocksIn(h, route.scope)).toHaveLength(0);
  expect(moveLocksIn(h, across)).toHaveLength(0);
  expect(charged).toEqual({ consumedBytes: WHOLE_NOTE_BYTES, noteCount: 1 });
  expect(quotaTotals(h, across)).toEqual({ consumedBytes: 0, noteCount: 0 });
  expect(notesIn(h, across)).toHaveLength(0);
  expect(revisionsIn(h, across)).toHaveLength(0);
  expect(filesIn(h, across)).toHaveLength(0);
};

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

  it("TC-note-249 / TC-note-764: note, revisions, file metadata and the usage delta land in a target scope that has no quota row yet", async () => {
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
    // The target scope's projection *generation counter* is prepared in
    // the same transaction. The projection rows themselves are not
    // rebuilt in this slice — nothing subscribes to `note.moved` yet — so
    // this asserts the counter, not a read model.
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

  it("TC-note-254: a source demotion that lands while the pre-flight is still deciding cannot take the note out of the workspace", async () => {
    const h = createTestHarness();
    await seedSource(h, "editor");
    const noteId = await createNote(h, { workspaceId: SOURCE_WS });
    let demoted = false;
    const container = withMembershipReadHook(h, async (scope, role) => {
      if (
        !demoted &&
        ScopeKey.equals(scope, sourceWsScope) &&
        role === "editor"
      ) {
        demoted = true;
        await demoteMembership(h, SOURCE_WS, ACTOR);
      }
    });

    await expectConflict(move(h, { noteId, container }), "STALE_MEMBERSHIP");

    expect(demoted).toBe(true);
    expect(notesIn(h, sourceWsScope)).toHaveLength(1);
    expect(notesIn(h, personalScope)).toHaveLength(0);
    expect(await routeOf(h, noteId)).toMatchObject({
      state: "active",
      scope: sourceWsScope,
    });
  });

  it("TC-note-254: a demotion that lands while the pre-flight is still deciding cannot slip between the role and the version", async () => {
    const h = createTestHarness();
    await seedTarget(h, "editor");
    const noteId = await createNote(h);
    let demoted = false;
    // The target answers "editor", and the role is taken away before the
    // pre-flight is done with it. A version pinned by a *later* read would
    // describe the demoted row, so every commit-time re-check — which
    // compares versions, not roles — would find nothing wrong.
    const container = withMembershipReadHook(h, async (scope, role) => {
      if (
        !demoted &&
        ScopeKey.equals(scope, targetScope) &&
        role === "editor"
      ) {
        demoted = true;
        await demoteMembership(h, TARGET_WS, ACTOR);
      }
    });

    await expectBusinessRule(
      move(h, { noteId, workspaceId: TARGET_WS, container }),
      WorkspaceErrorCode.InsufficientRole,
    );

    expect(demoted).toBe(true);
    expect(notesIn(h, targetScope)).toHaveLength(0);
    expect(notesIn(h, personalScope)).toHaveLength(1);
    expect(operations(h)).toHaveLength(0);
    expect(await routeOf(h, noteId)).toMatchObject({
      state: "active",
      scope: personalScope,
    });
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

  it("TC-note-258: the resume after an abort re-stages the revisions, the file metadata and the credit too", async () => {
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

    await move(h, { noteId, workspaceId: TARGET_WS });

    // Everything the abort gave back is staged again, not skipped as
    // "already applied" on the strength of the first attempt's receipts.
    expect(notesIn(h, targetScope)).toHaveLength(1);
    expect(revisionsIn(h, targetScope)).toHaveLength(1);
    expect(filesIn(h, targetScope)).toHaveLength(1);
    expect(quotaOf(h, targetScope)).toMatchObject({
      consumedBytes: 120,
      noteCount: 1,
    });
    expect(notesIn(h, personalScope)).toHaveLength(0);
    expect(filesIn(h, personalScope)).toHaveLength(0);
    expect(quotaOf(h, personalScope)).toMatchObject({
      consumedBytes: 0,
      noteCount: 0,
    });
  });

  it("TC-note-258: the resume after an abort re-stages the tag half, whose receipts the seam declares", async () => {
    const h = createTestHarness();
    await seedTarget(h, "editor");
    const noteId = await createNote(h);
    const stagings: string[] = [];
    const tagRelocation = recordingTagRelocation(stagings);
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
      move(h, { noteId, workspaceId: TARGET_WS, container, tagRelocation }),
    ).rejects.toThrow("switch failed");
    expect(stagings).toHaveLength(1);

    await move(h, { noteId, workspaceId: TARGET_WS, tagRelocation });

    // The abort cleared the key the seam declared along with the note's
    // own, so the resumed staging runs the tag half again instead of
    // skipping it on a receipt whose rows the abort deleted.
    expect(stagings).toHaveLength(2);
    expect(notesIn(h, targetScope)).toHaveLength(1);
    expect(notesIn(h, personalScope)).toHaveLength(0);
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
    // The thaw is the compensation's own precondition, so its lost
    // response is resolved by re-reading the route rather than treated as
    // a refusal — the abort goes on to reverse what it staged.
    expect(
      h.logger.byLevel("error").map((entry) => entry.message),
    ).not.toContain("[moveNote] rollback failed before route switch");
    // Settled even though the compensation failed: an operation nobody
    // can drive would refuse every later move of this note.
    expect(operations(h)[0]).toMatchObject({ state: "rejected" });

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

  it("TC-note-263: a move stranded after the switch refuses a different move instead of unwinding it", async () => {
    const h = createTestHarness();
    await seedTarget(h, "editor");
    await seedSource(h, "editor");
    const noteId = await createNote(h);
    await seedRevision(h, personalScope, noteId, "revision-1");
    // The retire commits and the settle never lands, so the operation is
    // left `running` over a note that already lives in the target.
    const container = withScopeRunHooks(h, {
      after: (_scope, index) => {
        if (index === 3) {
          throw failure("settle response lost");
        }
      },
    });

    await expect(
      move(h, { noteId, workspaceId: TARGET_WS, container }),
    ).rejects.toThrow("settle response lost");
    expect(operations(h)[0]).toMatchObject({ state: "running" });
    expect(notesIn(h, targetScope)).toHaveLength(1);

    await expectConflict(
      move(h, { noteId, workspaceId: SOURCE_WS, expectedVersion: null }),
      "NOTE_MOVE_IN_PROGRESS",
    );

    // Joining the stranded operation would run its plan: freeze a source
    // that is already retired, fail, and abort the *target* it switched
    // to — deleting the only copy of the note and its revisions.
    expect(notesIn(h, targetScope)).toHaveLength(1);
    expect(revisionsIn(h, targetScope)).toHaveLength(1);
    expect(notesIn(h, sourceWsScope)).toHaveLength(0);
    expect(notesIn(h, personalScope)).toHaveLength(0);
    expect(await routeOf(h, noteId)).toMatchObject({
      state: "active",
      scope: targetScope,
      routeVersion: 2,
    });
  });

  it("TC-note-261: a move that never claimed the route settles its operation instead of holding the note hostage", async () => {
    const h = createTestHarness();
    await seedTarget(h, "editor");
    await seedSource(h, "editor");
    const noteId = await createNote(h);
    let claimAttempted = false;
    const container = withRouteStore(h, {
      beginMove: (input) => {
        if (!claimAttempted) {
          claimAttempted = true;
          return Promise.reject(failure("claim failed"));
        }
        return h.container.noteRouteStore.beginMove(input);
      },
    });

    await expect(
      move(h, { noteId, workspaceId: TARGET_WS, container }),
    ).rejects.toThrow("claim failed");

    expect(operations(h)).toHaveLength(1);
    expect(operations(h)[0]).toMatchObject({ state: "rejected" });

    // A `running` leftover would make the store join this request to it,
    // and the guard would then refuse a move nothing is in the way of.
    const view = await move(h, { noteId, workspaceId: SOURCE_WS });
    expect(view.ownerId).toBe(SOURCE_WS);
  });

  it("TC-note-261: a route store that also fails the release neither replaces the claim's diagnosis nor leaves the operation running", async () => {
    const h = createTestHarness();
    await seedTarget(h, "editor");
    await seedSource(h, "editor");
    const noteId = await createNote(h);
    let claimAttempted = false;
    const container = withRouteStore(h, {
      beginMove: () => {
        claimAttempted = true;
        return Promise.reject(failure("claim failed"));
      },
      // The release reads the route through the same store the claim just
      // failed on, so the correlated failure is the expected one.
      resolve: (id) =>
        claimAttempted
          ? Promise.reject(failure("route read failed"))
          : h.container.noteRouteStore.resolve(id),
    });

    await expect(
      move(h, { noteId, workspaceId: TARGET_WS, container }),
    ).rejects.toThrow("claim failed");

    expect(operations(h)).toHaveLength(1);
    expect(operations(h)[0]).toMatchObject({ state: "rejected" });

    // Left `running`, the store would join this request to it and refuse a
    // move nothing is in the way of.
    const view = await move(h, { noteId, workspaceId: SOURCE_WS });
    expect(view.ownerId).toBe(SOURCE_WS);
  });

  it("TC-note-261: a claim whose response was lost gives the route back instead of parking it", async () => {
    const h = createTestHarness();
    await seedMovePair(h);
    const noteId = await seedWholeNote(h);

    await expect(
      move(h, {
        noteId,
        workspaceId: TARGET_WS,
        expectedVersion: null,
        container: withLostResponseAt(h, "claimRoute"),
      }),
    ).rejects.toThrow("claimRoute response lost");

    // The claim committed, nothing was staged, and the operation is
    // settled — so nobody is left to drive that claim.
    expect(operations(h)[0]).toMatchObject({ state: "rejected" });
    expect(await routeOf(h, noteId)).toMatchObject({
      state: "active",
      scope: sourceWsScope,
      routeVersion: 1,
    });

    // Another member's move to another destination is not held hostage by
    // it: a route left `moving` would refuse every later move of the note.
    const view = await move(h, {
      noteId,
      userId: OTHER,
      expectedVersion: null,
    });

    expect(view).toMatchObject({ ownerType: "user", ownerId: OTHER });
    expect(await routeOf(h, noteId)).toMatchObject({
      state: "active",
      scope: otherPersonalScope,
    });
    expect(notesIn(h, otherPersonalScope)).toHaveLength(1);
  });

  it("TC-note-254: a retry completes across a membership change made after the first attempt failed", async () => {
    const h = createTestHarness();
    await seedTarget(h, "owner");
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

    // The actor is demoted to editor — still allowed to move a note in,
    // but the Membership version the first attempt pinned is now stale.
    await changeMemberRole({
      container: h.container,
      input: {
        workspaceId: TARGET_WS,
        actorUserId: BOSS,
        membershipId: "membership-actor",
        role: "editor",
      },
    });

    const view = await move(h, { noteId, workspaceId: TARGET_WS });

    // The pin is this attempt's, so the operation is not stuck on a
    // version that only the first attempt ever saw.
    expect(view.ownerId).toBe(TARGET_WS);
    expect(operations(h)).toHaveLength(1);
    expect(notesIn(h, targetScope)).toHaveLength(1);
    expect(notesIn(h, personalScope)).toHaveLength(0);
  });

  it("TC-note-260: an abort reverses staged rows the failing attempt never observed", async () => {
    const h = createTestHarness();
    await seedTarget(h, "editor");
    const noteId = await createNote(h);
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
    // The first attempt stages the target and then dies before its own
    // compensation reaches that scope: the staged note, its file row and
    // its credit outlive the attempt that made them.
    let runs = 0;
    const stranded: RequestContainer = {
      ...h.container,
      noteRouteStore: {
        ...h.container.noteRouteStore,
        switchMove: () => Promise.reject(failure("switch failed")),
      },
      scopeUnitOfWorkProvider: {
        run: <T>(
          scope: ScopeKey,
          fn: (ctx: ScopeUnitOfWorkContext) => Promise<T>,
        ): Promise<T> => {
          runs += 1;
          // 0 freeze, 1 stage, 2 the rollback's undo of the target.
          return runs === 3
            ? Promise.reject(failure("rollback died"))
            : h.container.scopeUnitOfWorkProvider.run(scope, fn);
        },
      },
    };

    await expect(
      move(h, { noteId, workspaceId: TARGET_WS, container: stranded }),
    ).rejects.toThrow("switch failed");
    expect(filesIn(h, targetScope)).toHaveLength(1);
    expect(quotaOf(h, targetScope)).toMatchObject({ consumedBytes: 120 });

    // The next attempt loses the source before it can freeze it, so it
    // reaches the abort holding no snapshot of its own.
    const container = withScopeRunHooks(h, {
      before: async (_scope, index) => {
        if (index === 0) {
          await deleteNoteRow(h, personalScope, noteId);
        }
      },
    });

    await expectNotFound(
      move(h, { noteId, workspaceId: TARGET_WS, container }),
      "NOTE_NOT_FOUND",
    );

    // "Complete" is a property of the target, not of the attempt: the
    // rows are found by enumerating the scope that holds them.
    expect(notesIn(h, targetScope)).toHaveLength(0);
    expect(filesIn(h, targetScope)).toHaveLength(0);
    expect(quotaOf(h, targetScope)).toMatchObject({
      consumedBytes: 0,
      noteCount: 0,
    });
  });

  it("TC-note-257: a caller that holds no version moves the note without an optimistic check", async () => {
    const h = createTestHarness();
    await seedTarget(h, "editor");
    const noteId = await createNote(h);
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

    const view = await move(h, {
      noteId,
      workspaceId: TARGET_WS,
      expectedVersion: null,
    });

    // The version answered is the staged copy's, not the requester's
    // arithmetic on a version it may never have seen.
    expect(view).toMatchObject({ ownerId: TARGET_WS, version: 2 });
    expect(notesIn(h, targetScope)[0]?.version).toBe(2);
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

  it("TC-note-761: an abort that follows a switch whose response was lost undoes nothing", async () => {
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
    // The switch commits and only its response is lost. Unlike the crash
    // case, the process is alive, so the rollback runs in full — over a
    // target that is by then the note's only home.
    const container = withRouteStore(h, {
      switchMove: async (input) => {
        await h.container.noteRouteStore.switchMove(input);
        throw failure("switch response lost");
      },
    });

    await expect(
      move(h, { noteId, workspaceId: TARGET_WS, container }),
    ).rejects.toThrow("switch response lost");

    expect(await routeOf(h, noteId)).toMatchObject({
      state: "active",
      scope: targetScope,
      routeVersion: 2,
    });
    expect(notesIn(h, targetScope)).toHaveLength(1);
    expect(revisionsIn(h, targetScope)).toHaveLength(1);
    expect(filesIn(h, targetScope)).toHaveLength(1);
    expect(quotaOf(h, targetScope)).toMatchObject({
      consumedBytes: 120,
      noteCount: 1,
    });
    expect(await read(h, noteId)).toMatchObject({
      ownerType: "workspace",
      ownerId: TARGET_WS,
    });
    // Recorded as a post-switch strand, which is what it is.
    expect(h.logger.byLevel("error").map((entry) => entry.message)).toContain(
      "[moveNote] stuck after the route switch",
    );
  });

  it("TC-note-767: an abort that stands down after the switch leaves a stop something can still drive", async () => {
    const h = createTestHarness();
    await seedTarget(h, "editor");
    const noteId = await createNote(h);
    const container = withRouteStore(h, {
      switchMove: async (input) => {
        await h.container.noteRouteStore.switchMove(input);
        throw failure("switch response lost");
      },
    });

    await expect(
      move(h, { noteId, workspaceId: TARGET_WS, container }),
    ).rejects.toThrow("switch response lost");

    // Neither phase that releases a lock ran, so both locks stand — and
    // the only caller that may release them is one holding this migration
    // id. A terminal operation makes the next request a new migration, so
    // settling here would take both workspaces' deletion and membership
    // management away for good instead of leaving a stop to recover from.
    expect(moveLocksIn(h, personalScope)).toHaveLength(1);
    expect(moveLocksIn(h, targetScope)).toHaveLength(1);
    expect(operations(h)[0]).toMatchObject({ state: "running" });
  });

  it("TC-note-768: an abort leaves the copy a rival migration staged in the target alone", async () => {
    const h = createTestHarness();
    await seedMovePair(h);
    const noteId = await seedWholeNote(h);

    // A second migration takes the route this one just thawed and stages
    // its own copy, then dies before its own compensation reaches the
    // target. From here on the target's contents are the rival's.
    const stageRival = async (): Promise<void> => {
      let rivalRuns = 0;
      const stranded: RequestContainer = {
        ...h.container,
        noteRouteStore: {
          ...h.container.noteRouteStore,
          switchMove: () => Promise.reject(failure("rival switch failed")),
        },
        scopeUnitOfWorkProvider: {
          run: <T>(
            scope: ScopeKey,
            fn: (ctx: ScopeUnitOfWorkContext) => Promise<T>,
          ): Promise<T> => {
            rivalRuns += 1;
            // 0 freeze, 1 stage, 2 the rollback's undo of the target.
            return rivalRuns === 3
              ? Promise.reject(failure("rival rollback died"))
              : h.container.scopeUnitOfWorkProvider.run(scope, fn);
          },
        },
      };
      await expect(
        move(h, {
          noteId,
          workspaceId: TARGET_WS,
          userId: OTHER,
          expectedVersion: null,
          container: stranded,
        }),
      ).rejects.toThrow("rival switch failed");
    };

    // The attempt that aborts below resumes an operation that is already
    // terminal — the shape a re-request takes after a failure settled its
    // own row (`beginOrResume` matches the request key whatever the state
    // says). That is what lets a second migration exist at the same time:
    // while any operation of this note is `running`, every other request
    // joins it and is refused.
    await expect(
      move(h, {
        noteId,
        workspaceId: TARGET_WS,
        expectedVersion: null,
        container: withScopeRunHooks(h, {
          before: (_scope, index) => {
            if (index === 0) {
              throw failure("the first freeze failed");
            }
          },
        }),
      }),
    ).rejects.toThrow("the first freeze failed");
    expect(operations(h)[0]).toMatchObject({ state: "rejected" });
    expect(notesIn(h, targetScope)).toHaveLength(0);

    let runs = 0;
    let rivalStaged = false;
    const container: RequestContainer = {
      ...h.container,
      scopeUnitOfWorkProvider: {
        run: async <T>(
          scope: ScopeKey,
          fn: (ctx: ScopeUnitOfWorkContext) => Promise<T>,
        ): Promise<T> => {
          const index = runs;
          runs += 1;
          // 0 freeze, 1 the rollback's undo of the target — and the thaw
          // that precedes it has already handed the route back, so the
          // window the rival claims in is between the two.
          if (index === 1 && !rivalStaged) {
            rivalStaged = true;
            await stageRival();
          }
          const result = await h.container.scopeUnitOfWorkProvider.run(
            scope,
            fn,
          );
          if (index === 0) {
            throw failure("snapshotSource response lost");
          }
          return result;
        },
      },
    };

    await expect(
      move(h, {
        noteId,
        workspaceId: TARGET_WS,
        expectedVersion: null,
        container,
      }),
    ).rejects.toThrow("snapshotSource response lost");

    expect(rivalStaged).toBe(true);
    // Two migrations, and the target's contents belong to the other one.
    expect(operations(h)).toHaveLength(2);
    // Nothing in the target was put there by this migration, so nothing
    // in it is this migration's to reverse: the rival is the only one
    // that can switch to that copy or give it back, and tearing it down
    // loses the note the moment the rival's switch lands.
    expect(notesIn(h, targetScope)).toHaveLength(1);
    expect(revisionsIn(h, targetScope)).toHaveLength(1);
    expect(filesIn(h, targetScope)).toHaveLength(1);
    expect(quotaTotals(h, targetScope)).toEqual({
      consumedBytes: WHOLE_NOTE_BYTES,
      noteCount: 1,
    });
    expect(await routeOf(h, noteId)).toMatchObject({
      state: "active",
      scope: sourceWsScope,
    });
    expect(notesIn(h, sourceWsScope)).toHaveLength(1);
  });

  it("TC-note-769: a thaw whose route another migration has already claimed still gives this migration's own leftovers back", async () => {
    const h = createTestHarness();
    await seedMovePair(h);
    const noteId = await seedWholeNote(h);

    // The thaw commits and only its response is lost, so the compensation
    // re-reads the route to decide whether it may run — and by then the
    // route it gave back is `moving` again under someone else's migration
    // id. What this migration staged is identified by its own receipt, so
    // the rival's side is out of reach whatever the read says; standing
    // down here would instead leave this migration's own lock and its
    // operation with nobody able to release them.
    let thawed = false;
    let runs = 0;
    const container: RequestContainer = {
      ...h.container,
      noteRouteStore: {
        ...h.container.noteRouteStore,
        abortMove: async (input) => {
          const route = await h.container.noteRouteStore.abortMove(input);
          thawed = true;
          await h.container.noteRouteStore.beginMove({
            noteId: NoteId.create(noteId),
            expectedRouteVersion: route.routeVersion,
            target: targetScope,
            migrationId: "rival-migration",
          });
          throw failure("abort response lost");
        },
      },
      scopeUnitOfWorkProvider: {
        run: <T>(
          scope: ScopeKey,
          fn: (ctx: ScopeUnitOfWorkContext) => Promise<T>,
        ): Promise<T> => {
          const index = runs;
          runs += 1;
          // 0 freeze — which stages the source's move lock — then 1 the
          // staging this test fails, and 2 / 3 the compensation's own.
          return index === 1
            ? Promise.reject(failure("the staging failed"))
            : h.container.scopeUnitOfWorkProvider.run(scope, fn);
        },
      },
    };

    await expect(
      move(h, {
        noteId,
        workspaceId: TARGET_WS,
        expectedVersion: null,
        container,
      }),
    ).rejects.toThrow("the staging failed");

    expect(thawed).toBe(true);
    expect(moveLocksIn(h, sourceWsScope)).toHaveLength(0);
    expect(moveLocksIn(h, targetScope)).toHaveLength(0);
    expect(operations(h)[0]).toMatchObject({ state: "rejected" });
    // The rival's claim, and everything it may still stage under it, are
    // left exactly as they were.
    expect(await routeOf(h, noteId)).toMatchObject({
      state: "moving",
      scope: sourceWsScope,
      migrationId: "rival-migration",
    });
    expect(notesIn(h, sourceWsScope)).toHaveLength(1);
  });

  const MOVE_SEAMS: readonly MoveSeam[] = [
    "beginOperation",
    "claimRoute",
    "snapshotSource",
    "stageTarget",
    "switchMove",
    "activateTarget",
    "retireSource",
    "settle",
  ];
  const MOVE_FOLLOW_UPS: readonly MoveFollowUp[] = [
    "nothing follows",
    "the same actor asks again",
    "another editor asks for the same move",
  ];

  for (const seam of MOVE_SEAMS) {
    for (const follow of MOVE_FOLLOW_UPS) {
      it(`TC-note-266: losing the ${seam} response keeps the note whole and reachable when ${follow}`, async () => {
        const h = createTestHarness();
        await seedMovePair(h);
        const noteId = await seedWholeNote(h);

        const attempt = move(h, {
          noteId,
          workspaceId: TARGET_WS,
          expectedVersion: null,
          container: withLostResponseAt(h, seam),
        });
        if (seam === "settle") {
          // The one seam whose loss the caller must not be told about:
          // route, target and source are all final by the time the
          // control row is closed, so reporting it would refuse a move
          // that happened and then refuse the retry as well.
          await expect(attempt).resolves.toMatchObject({
            ownerId: TARGET_WS,
          });
        } else {
          await expect(attempt).rejects.toThrow("response lost");
        }
        await expectWholeAndReachable(h, noteId);

        await runFollowUp(h, follow, noteId);
        await expectWholeAndReachable(h, noteId);
      });
    }
  }

  it("TC-note-762: another member's request is authorized about that member, not about the actor whose attempt failed", async () => {
    const h = createTestHarness();
    await seedMovePair(h);
    const noteId = await seedWholeNote(h);
    await expect(
      move(h, {
        noteId,
        workspaceId: TARGET_WS,
        expectedVersion: null,
        container: withRouteStore(h, {
          switchMove: () => Promise.reject(failure("switch failed")),
        }),
      }),
    ).rejects.toThrow("switch failed");

    // Both editors joined together, so their Membership versions agree:
    // an operation resumed from the first actor would check a row that
    // nothing touched and let the move commit for a member the target no
    // longer has.
    const container = withScopeRunHooks(h, {
      before: async (_scope, index) => {
        if (index === 1) {
          await dropMembership(h, TARGET_WS, OTHER);
        }
      },
    });

    await expectBusinessRule(
      move(h, {
        noteId,
        workspaceId: TARGET_WS,
        userId: OTHER,
        expectedVersion: null,
        container,
      }),
      WorkspaceErrorCode.InsufficientRole,
    );

    // A request of its own, not a resumption of somebody else's.
    expect(operations(h)).toHaveLength(2);
    expect(notesIn(h, targetScope)).toHaveLength(0);
    expect(notesIn(h, sourceWsScope)).toHaveLength(1);
  });

  it("TC-note-762: the version another member's request pins is that member's own", async () => {
    const h = createTestHarness();
    await seedMovePair(h);
    const noteId = await seedWholeNote(h);
    await expect(
      move(h, {
        noteId,
        workspaceId: TARGET_WS,
        expectedVersion: null,
        container: withRouteStore(h, {
          switchMove: () => Promise.reject(failure("switch failed")),
        }),
      }),
    ).rejects.toThrow("switch failed");

    const container = withScopeRunHooks(h, {
      before: async (_scope, index) => {
        if (index === 1) {
          await demoteMembership(h, TARGET_WS, OTHER);
        }
      },
    });

    await expectConflict(
      move(h, {
        noteId,
        workspaceId: TARGET_WS,
        userId: OTHER,
        expectedVersion: null,
        container,
      }),
      "STALE_MEMBERSHIP",
    );

    expect(operations(h)).toHaveLength(2);
    expect(notesIn(h, targetScope)).toHaveLength(0);
    expect(notesIn(h, sourceWsScope)).toHaveLength(1);
  });

  it("TC-note-760: a note that leaves its scope between the pre-flight and the claim is refused as a stale route", async () => {
    const h = createTestHarness();
    await seedTarget(h, "editor");
    await seedSource(h, "editor");
    const noteId = await createNote(h, { workspaceId: SOURCE_WS });
    const id = NoteId.create(noteId);
    // A rival move that completes in the window between this request's
    // pre-flight read and 手順 4's re-read of the route.
    const rivalMove = async (): Promise<void> => {
      const moved = await h.container.scopeUnitOfWorkProvider.run(
        sourceWsScope,
        async (ctx) => {
          const stored = await ctx.noteRepository.findById(id);
          if (stored === null || !Note.isActive(stored.entity)) {
            throw new Error("seed missing");
          }
          await ctx.noteRepository.delete(id, stored.expectedVersion);
          return Note.withOwner(
            stored.entity,
            NoteOwner.user(actorId),
            h.clock.now(),
          );
        },
      );
      await h.container.scopeUnitOfWorkProvider.run(personalScope, (ctx) =>
        ctx.noteRepository.insert(moved),
      );
      await h.container.noteRouteStore.beginMove({
        noteId: id,
        expectedRouteVersion: 1,
        target: personalScope,
        migrationId: "rival-migration",
      });
      await h.container.noteRouteStore.switchMove({
        noteId: id,
        migrationId: "rival-migration",
        expectedRouteVersion: 1,
      });
    };
    let resolves = 0;
    const container = withRouteStore(h, {
      resolve: async (noteKey) => {
        resolves += 1;
        if (resolves === 2) {
          await rivalMove();
        }
        return h.container.noteRouteStore.resolve(noteKey);
      },
    });

    await expectConflict(
      move(h, {
        noteId,
        workspaceId: TARGET_WS,
        expectedVersion: null,
        container,
      }),
      "STALE_SCOPE_ROUTE",
    );

    // The claim is refused rather than taken on a route the payload no
    // longer describes, so nothing is staged and nothing is left `moving`.
    expect(notesIn(h, targetScope)).toHaveLength(0);
    expect(notesIn(h, personalScope)).toHaveLength(1);
    expect(await routeOf(h, noteId)).toMatchObject({
      state: "active",
      scope: personalScope,
      routeVersion: 2,
    });
    expect(operations(h)[0]).toMatchObject({ state: "rejected" });
  });

  it("TC-note-763: a resume whose staging was already applied retires only what actually crossed", async () => {
    const h = createTestHarness();
    await seedTarget(h, "editor");
    const noteId = await createNote(h);
    await seedFile(h, personalScope, StorageOwner.user(actorId), {
      id: "file-source",
      noteId,
      purpose: "source",
      size: 120,
    });
    await seedQuota(h, personalScope, StorageOwner.user(actorId), {
      bytes: 210,
      notes: 1,
    });
    // The staging commits, the switch fails, and the abort dies before it
    // reaches the target: the staged rows and their receipts both stand.
    let runs = 0;
    const stranded: RequestContainer = {
      ...h.container,
      noteRouteStore: {
        ...h.container.noteRouteStore,
        switchMove: () => Promise.reject(failure("switch failed")),
      },
      scopeUnitOfWorkProvider: {
        run: <T>(
          scope: ScopeKey,
          fn: (ctx: ScopeUnitOfWorkContext) => Promise<T>,
        ): Promise<T> => {
          runs += 1;
          // 0 freeze, 1 stage, 2 the rollback's undo of the target.
          return runs === 3
            ? Promise.reject(failure("rollback died"))
            : h.container.scopeUnitOfWorkProvider.run(scope, fn);
        },
      },
    };

    await expect(
      move(h, { noteId, workspaceId: TARGET_WS, container: stranded }),
    ).rejects.toThrow("switch failed");
    expect(filesIn(h, targetScope)).toHaveLength(1);

    // A file lands on the source between the attempts: the move lock
    // stops membership changes and deletion, not uploads.
    await seedFile(h, personalScope, StorageOwner.user(actorId), {
      id: "file-late",
      noteId,
      purpose: "media",
      size: 90,
    });

    await move(h, { noteId, workspaceId: TARGET_WS, expectedVersion: null });

    // The staging was skipped on its receipt, so the late file never
    // crossed — and what never crossed is not retired.
    expect(filesIn(h, targetScope).map((file) => file.id)).toEqual([
      "file-source",
    ]);
    expect(filesIn(h, personalScope).map((file) => file.id)).toEqual([
      "file-late",
    ]);
    expect(quotaOf(h, personalScope)).toMatchObject({
      consumedBytes: 90,
      noteCount: 0,
    });
    expect(quotaOf(h, targetScope)).toMatchObject({
      consumedBytes: 120,
      noteCount: 1,
    });
    expect(notesIn(h, targetScope)).toHaveLength(1);
    expect(notesIn(h, personalScope)).toHaveLength(0);
  });

  it("TC-note-765: a resumed attempt that loses its claim gives back the staging the earlier attempt left, not just the route", async () => {
    const h = createTestHarness();
    await seedMovePair(h);
    const noteId = await seedWholeNote(h);

    // The first attempt stages the target and then loses the route store
    // itself, so the route stays `moving` under this migration while the
    // staged copy, its credit and both move locks outlive the attempt.
    let switchTried = false;
    const stranded: RequestContainer = {
      ...h.container,
      noteRouteStore: {
        ...h.container.noteRouteStore,
        switchMove: () => {
          switchTried = true;
          return Promise.reject(failure("switch failed"));
        },
        abortMove: () => Promise.reject(failure("route store down")),
        resolve: (id) =>
          switchTried
            ? Promise.reject(failure("route store down"))
            : h.container.noteRouteStore.resolve(id),
      },
    };

    await expect(
      move(h, {
        noteId,
        workspaceId: TARGET_WS,
        expectedVersion: null,
        container: stranded,
      }),
    ).rejects.toThrow("switch failed");
    expect(await routeOf(h, noteId)).toMatchObject({
      state: "moving",
      routeVersion: 1,
    });
    expect(notesIn(h, targetScope)).toHaveLength(1);
    expect(moveLocksIn(h, sourceWsScope)).toHaveLength(1);
    expect(moveLocksIn(h, targetScope)).toHaveLength(1);

    // The resume loses its own claim. Handing the route back on its own
    // would strand those locks: nothing but this migration can release
    // them, and the next destination the user picks makes the request key
    // that could resume it underivable.
    await expect(
      move(h, {
        noteId,
        workspaceId: TARGET_WS,
        expectedVersion: null,
        container: withLostResponseAt(h, "claimRoute"),
      }),
    ).rejects.toThrow("claimRoute response lost");

    expect(await routeOf(h, noteId)).toMatchObject({
      state: "active",
      scope: sourceWsScope,
      routeVersion: 1,
    });
    expect(moveLocksIn(h, sourceWsScope)).toHaveLength(0);
    expect(moveLocksIn(h, targetScope)).toHaveLength(0);
    expect(notesIn(h, targetScope)).toHaveLength(0);
    expect(revisionsIn(h, targetScope)).toHaveLength(0);
    expect(filesIn(h, targetScope)).toHaveLength(0);
    expect(quotaOf(h, targetScope)).toMatchObject({
      consumedBytes: 0,
      noteCount: 0,
    });
    expect(operations(h)[0]).toMatchObject({ state: "rejected" });
    await expectWholeAndReachable(h, noteId);

    // What a leftover lock refuses for good, now that nothing holds one.
    const deleted = await deleteWorkspace({
      container: h.container,
      input: {
        workspaceId: TARGET_WS,
        userId: BOSS,
        confirmationName: WORKSPACE_NAME,
      },
    });
    expect(deleted.status).toBe("accepted");
  });

  it("TC-note-766: a resume whose staging was already applied carries the edit the source took in between", async () => {
    const h = createTestHarness();
    await seedTarget(h, "editor");
    const noteId = await createNote(h);
    await seedRevision(h, personalScope, noteId, "revision-1");
    // The staging commits, the switch fails, and the abort dies before it
    // reaches the target: the staged copy and its receipts both stand.
    let runs = 0;
    const stranded: RequestContainer = {
      ...h.container,
      noteRouteStore: {
        ...h.container.noteRouteStore,
        switchMove: () => Promise.reject(failure("switch failed")),
      },
      scopeUnitOfWorkProvider: {
        run: <T>(
          scope: ScopeKey,
          fn: (ctx: ScopeUnitOfWorkContext) => Promise<T>,
        ): Promise<T> => {
          runs += 1;
          // 0 freeze, 1 stage, 2 the rollback's undo of the target.
          return runs === 3
            ? Promise.reject(failure("rollback died"))
            : h.container.scopeUnitOfWorkProvider.run(scope, fn);
        },
      },
    };

    await expect(
      move(h, { noteId, workspaceId: TARGET_WS, container: stranded }),
    ).rejects.toThrow("switch failed");
    expect(notesIn(h, targetScope)).toHaveLength(1);

    // The route names the source again, so the note is editable — the
    // move lock stops membership changes and deletion, not writes.
    await renameNoteRow(h, personalScope, noteId, "編集後");
    await seedRevision(h, personalScope, noteId, "revision-late");

    await move(h, { noteId, workspaceId: TARGET_WS, expectedVersion: null });

    // The staging is skipped on its receipt, and `retireSource` deletes
    // the source note and every revision it holds — so the copy the
    // target keeps has to be the one this attempt froze.
    expect(notesIn(h, targetScope)[0]?.title.value).toBe("編集後");
    expect(
      revisionsIn(h, targetScope)
        .map((revision) => revision.id)
        .sort(),
    ).toEqual(["revision-1", "revision-late"]);
    expect(await read(h, noteId)).toMatchObject({
      title: "編集後",
      ownerId: TARGET_WS,
    });
    expect(notesIn(h, personalScope)).toHaveLength(0);
    expect(revisionsIn(h, personalScope)).toHaveLength(0);
  });

  it("TC-note-770: a resume whose staged copy is already at the frozen version still carries the revisions the source gained", async () => {
    const h = createTestHarness();
    await seedTarget(h, "editor");
    const noteId = await createNote(h);
    await seedRevision(h, personalScope, noteId, "revision-1");
    let runs = 0;
    const stranded: RequestContainer = {
      ...h.container,
      noteRouteStore: {
        ...h.container.noteRouteStore,
        switchMove: () => Promise.reject(failure("switch failed")),
      },
      scopeUnitOfWorkProvider: {
        run: <T>(
          scope: ScopeKey,
          fn: (ctx: ScopeUnitOfWorkContext) => Promise<T>,
        ): Promise<T> => {
          runs += 1;
          // 0 freeze, 1 stage, 2 the rollback's undo of the target.
          return runs === 3
            ? Promise.reject(failure("rollback died"))
            : h.container.scopeUnitOfWorkProvider.run(scope, fn);
        },
      },
    };

    await expect(
      move(h, { noteId, workspaceId: TARGET_WS, container: stranded }),
    ).rejects.toThrow("switch failed");
    expect(revisionsIn(h, targetScope)).toHaveLength(1);

    // A revision that lands without a note write, which is what the two
    // attempts' equal versions mean: nothing tells the adoption that the
    // staged copy is short of one. `retireSource` deletes the source
    // revisions all the same, so what it does not carry is lost.
    await seedRevision(h, personalScope, noteId, "revision-late");

    await move(h, { noteId, workspaceId: TARGET_WS, expectedVersion: null });

    expect(
      revisionsIn(h, targetScope)
        .map((revision) => revision.id)
        .sort(),
    ).toEqual(["revision-1", "revision-late"]);
    expect(revisionsIn(h, personalScope)).toHaveLength(0);
    expect(await read(h, noteId)).toMatchObject({ ownerId: TARGET_WS });
  });
});
