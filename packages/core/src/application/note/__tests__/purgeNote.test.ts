import {
  isConflictError,
  isNotFoundError,
  isSystemError,
  isValidationError,
  SystemError,
  SystemErrorCode,
} from "@repo/core/application/errors";
import type { NoteRouteStore } from "@repo/core/application/ports/noteRouteStore";
import type { ScopeKey } from "@repo/core/application/scope";
import { UserId } from "@repo/core/domain/identity/valueObject";
import type { PublicNoteProjectionWriter } from "@repo/core/domain/note/ports/publicNoteProjectionWriter";
import { NoteId } from "@repo/core/domain/note/valueObject";
import { WorkspaceId } from "@repo/core/domain/workspace/valueObject";
import { describe, expect, it } from "vitest";
import { getNote } from "../getNote";
import { ownerPurgeOperationId, purgeNote } from "../purgeNote";
import { restoreNote } from "../restoreNote";
import { trashNote } from "../trashNote";
import {
  createPersonalNote,
  createTestHarness,
  createWorkspaceNote,
  eventsOfType,
  MEMBER,
  OWNER,
  removeMembership,
  seedRevision,
  seedWorkspace,
  storedNote,
  storedRevisions,
  type TestHarness,
  userScope,
  VIEWER,
  WORKSPACE,
  workspaceScope,
} from "./editingHarness";

const CLEANUP_OPERATION = "deletion-operation-1";

const trash = (h: TestHarness, noteId: string, userId: string = OWNER) =>
  trashNote({
    container: h.container,
    input: { noteId, userId, expectedVersion: 0, excludingJobId: null },
  });

/** A personal note already in the trash; its version is 1 after the move. */
const trashedPersonalNote = async (h: TestHarness): Promise<string> => {
  const noteId = await createPersonalNote(h);
  await trash(h, noteId);
  return noteId;
};

const purgeAsUser = (
  h: TestHarness,
  noteId: string,
  options: Readonly<{ userId?: string; expectedVersion?: number }> = {},
) =>
  purgeNote({
    container: h.container,
    input: {
      kind: "userRequest",
      noteId,
      userId: options.userId ?? OWNER,
      expectedVersion: options.expectedVersion ?? 1,
    },
  });

const purgeForCleanup = (
  h: TestHarness,
  noteId: string,
  options: Readonly<{
    scope?: ScopeKey;
    expectedVersion?: number;
    deletionOperationId?: string;
    container?: TestHarness["container"];
  }> = {},
) =>
  purgeNote({
    container: options.container ?? h.container,
    input: {
      kind: "scopeCleanup",
      noteId,
      expectedVersion: options.expectedVersion ?? 0,
      scope: options.scope ?? userScope,
      deletionOperationId: options.deletionOperationId ?? CLEANUP_OPERATION,
    },
  });

/** Puts the scope under a cleanup barrier owned by `operationId`. */
const beginCleanup = (
  h: TestHarness,
  scope: ScopeKey = userScope,
  operationId: string = CLEANUP_OPERATION,
  userId: string = OWNER,
): Promise<void> =>
  h.container.scopeUnitOfWorkProvider.run(scope, (ctx) =>
    ctx.cleanupAdmission.beginPersonalAccountDeletion(
      operationId,
      UserId.create(userId),
    ),
  );

const route = (h: TestHarness, noteId: string) =>
  h.backend.noteRoutes.get(noteId);

const purgedEvents = (h: TestHarness) => eventsOfType(h, "note.purged");

const purgeAckKeys = (h: TestHarness): readonly string[] =>
  h.backend.publicPurgeAcks.keys();

/** Wraps one route-store method, delegating everything else to the real one. */
const withRouteStore = (
  h: TestHarness,
  overrides: Partial<NoteRouteStore>,
): TestHarness["container"] => ({
  ...h.container,
  noteRouteStore: { ...h.container.noteRouteStore, ...overrides },
});

const withPublicProjection = (
  h: TestHarness,
  overrides: Partial<PublicNoteProjectionWriter>,
): TestHarness["container"] => ({
  ...h.container,
  publicNoteProjectionWriter: {
    ...h.container.publicNoteProjectionWriter,
    ...overrides,
  },
});

/**
 * Loses the response of the `openAt`-th scope transaction, once, *after*
 * it has committed — the window a driver fault cannot be distinguished
 * from, and the one an abort must not fire in.
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

/**
 * Takes the cleanup barrier away once the `openAt`-th scope transaction
 * has committed — the window between the entry gate's `assertOwner` and
 * the transaction that deletes.
 */
const losingTheScopeAfter = (
  h: TestHarness,
  openAt: number,
): TestHarness["container"] => {
  const real = h.container.scopeUnitOfWorkProvider;
  let opened = 0;
  let taken = false;
  return {
    ...h.container,
    scopeUnitOfWorkProvider: {
      run: (async (scope, body) => {
        opened += 1;
        const result = await real.run(scope, body);
        if (opened === openAt && !taken) {
          taken = true;
          await real.run(userScope, (ctx) =>
            ctx.cleanupAdmission.abortPersonalAccountDeletion(
              CLEANUP_OPERATION,
            ),
          );
        }
        return result;
      }) as typeof real.run,
    },
  };
};

/** Fails the wrapped call exactly once, then lets it through. */
const failOnce = <TArgs extends readonly unknown[], TResult>(
  real: (...args: TArgs) => Promise<TResult>,
  message: string,
): ((...args: TArgs) => Promise<TResult>) => {
  let failed = false;
  return async (...args: TArgs): Promise<TResult> => {
    if (!failed) {
      failed = true;
      throw new Error(message);
    }
    return real(...args);
  };
};

describe("purgeNote", () => {
  it("TC-note-348: a trashed note is deleted and note.purged is collected once", async () => {
    const h = createTestHarness();
    const noteId = await trashedPersonalNote(h);

    await purgeAsUser(h, noteId);

    expect(storedNote(h, noteId)).toBeNull();
    const events = purgedEvents(h);
    expect(events).toHaveLength(1);
    expect(events[0]?.payload).toMatchObject({
      noteId,
      owner: { type: "user", userId: OWNER },
      sourceFileId: null,
      deletionOperationId: null,
      routeVersion: 1,
      // Creation, trash, purge: the generation the fan-out compares the
      // removal against has to be the one the delete itself wrote.
      projectionRevision: 3,
    });
    expect(h.backend.scope(userScope).projectionRevisions.get(noteId)).toBe(3);
  });

  it("TC-note-348: a cleanup command naming the wrong scope is refused before the claim", async () => {
    const h = createTestHarness();
    await seedWorkspace(h, [{ userId: OWNER, role: "owner" }]);
    const noteId = await createWorkspaceNote(h);
    await beginCleanup(h, workspaceScope);

    await expect(
      purgeForCleanup(h, noteId, { scope: userScope }),
    ).rejects.toSatisfy(
      (error) => isConflictError(error) && error.code === "STALE_SCOPE_ROUTE",
    );
    expect(storedNote(h, noteId, workspaceScope)).not.toBeNull();
    expect(route(h, noteId)?.state).toBe("active");
  });

  it("TC-note-349: the route is purging under the operation id before anything local is deleted", async () => {
    const h = createTestHarness();
    const noteId = await trashedPersonalNote(h);
    const observed: Readonly<{
      state: string | undefined;
      operationId: string | null | undefined;
      externallyResolvable: boolean;
      noteStillThere: boolean;
    }>[] = [];
    const real = h.container.scopeUnitOfWorkProvider;
    const container = {
      ...h.container,
      scopeUnitOfWorkProvider: {
        // The window opens the instant the local transaction starts —
        // after the claim, before a single row is destroyed.
        run: ((scope, body) =>
          real.run(scope, async (ctx) => {
            const row = route(h, noteId);
            observed.push({
              state: row?.state,
              operationId: row?.operationId,
              externallyResolvable:
                (await h.container.noteRouteStore.resolve(
                  NoteId.create(noteId),
                )) !== null,
              noteStillThere: storedNote(h, noteId) !== null,
            });
            return body(ctx);
          })) as typeof real.run,
      },
    };

    await purgeNote({
      container,
      input: {
        kind: "userRequest",
        noteId,
        userId: OWNER,
        expectedVersion: 1,
      },
    });

    expect(observed).toEqual([
      {
        state: "purging",
        operationId: expect.any(String),
        externallyResolvable: false,
        noteStillThere: true,
      },
    ]);
    await expect(
      getNote({ container: h.container, input: { noteId, userId: OWNER } }),
    ).rejects.toSatisfy(isNotFoundError);
  });

  it("TC-note-350: a restore landing before the claim refuses the delete and returns the route to active", async () => {
    const h = createTestHarness();
    const noteId = await trashedPersonalNote(h);
    let restored = false;
    const container = withRouteStore(h, {
      // The window sits between the entry gate and the claim: the note
      // is out of the trash before this purge ever closes the route.
      beginPurge: async (input) => {
        if (!restored) {
          restored = true;
          await restoreNote({
            container: h.container,
            input: { noteId, userId: OWNER, expectedVersion: 1 },
          });
        }
        return h.container.noteRouteStore.beginPurge(input);
      },
    });

    await expect(
      purgeNote({
        container,
        input: {
          kind: "userRequest",
          noteId,
          userId: OWNER,
          expectedVersion: 1,
        },
      }),
    ).rejects.toSatisfy(isValidationError);

    expect(storedNote(h, noteId)?.lifecycle).toBe("active");
    expect(route(h, noteId)?.state).toBe("active");
    expect(purgedEvents(h)).toHaveLength(0);
  });

  it("TC-note-351: a membership removed before the local delete refuses and returns the route to active", async () => {
    const h = createTestHarness();
    await seedWorkspace(h, [
      { userId: OWNER, role: "owner" },
      { userId: MEMBER, role: "editor" },
    ]);
    const noteId = await createWorkspaceNote(h);
    await trashNote({
      container: h.container,
      input: {
        noteId,
        userId: MEMBER,
        expectedVersion: 0,
        excludingJobId: null,
      },
    });
    const real = h.container.scopeUnitOfWorkProvider;
    let removed = false;
    const container = {
      ...h.container,
      scopeUnitOfWorkProvider: {
        run: ((scope, body) => {
          const interfere = async (): Promise<void> => {
            if (!removed) {
              removed = true;
              await removeMembership(h, MEMBER);
            }
          };
          return interfere().then(() => real.run(scope, body));
        }) as typeof real.run,
      },
    };

    await expect(
      purgeNote({
        container,
        input: {
          kind: "userRequest",
          noteId,
          userId: MEMBER,
          expectedVersion: 1,
        },
      }),
    ).rejects.toSatisfy(isNotFoundError);

    expect(storedNote(h, noteId, workspaceScope)?.lifecycle).toBe("trashed");
    expect(route(h, noteId)?.state).toBe("active");
    expect(purgedEvents(h)).toHaveLength(0);
  });

  it("TC-note-352: an abort whose response was lost is retried under the same operation id", async () => {
    const h = createTestHarness();
    const noteId = await createPersonalNote(h);
    await beginCleanup(h);
    const container = withRouteStore(h, {
      abortPurge: failOnce(
        h.container.noteRouteStore.abortPurge,
        "abort response lost",
      ),
    });
    // The version the enumeration saw is stale, so every attempt refuses
    // the delete and has to hand the route back.
    const stale = { expectedVersion: 7, container };

    await expect(purgeForCleanup(h, noteId, stale)).rejects.toThrow();
    expect(route(h, noteId)?.state).toBe("purging");
    const operationId = route(h, noteId)?.operationId;

    await expect(purgeForCleanup(h, noteId, stale)).rejects.toThrow();

    expect(operationId).toBe(
      await ownerPurgeOperationId(CLEANUP_OPERATION, NoteId.create(noteId)),
    );
    expect(route(h, noteId)?.state).toBe("active");
    expect(storedNote(h, noteId)).not.toBeNull();
    expect(purgedEvents(h)).toHaveLength(0);
  });

  it("TC-note-353: a stop between the local delete and the public removal resumes at the public removal", async () => {
    const h = createTestHarness();
    const noteId = await createPersonalNote(h);
    await beginCleanup(h);
    const container = withPublicProjection(h, {
      removeForPurge: failOnce(
        h.container.publicNoteProjectionWriter.removeForPurge,
        "public removal lost",
      ),
    });

    await expect(purgeForCleanup(h, noteId, { container })).rejects.toThrow();
    expect(storedNote(h, noteId)).toBeNull();
    expect(route(h, noteId)?.state).toBe("purging");
    expect(purgeAckKeys(h)).toEqual([]);

    await purgeForCleanup(h, noteId, { container });

    const operationId = await ownerPurgeOperationId(
      CLEANUP_OPERATION,
      NoteId.create(noteId),
    );
    expect(purgeAckKeys(h)).toEqual([`${operationId} ${noteId}`]);
    expect(route(h, noteId)?.state).toBe("tombstone");
    // The delete committed on the first attempt, so the resume must not
    // publish a second hand-off to the fan-out.
    expect(purgedEvents(h)).toHaveLength(1);
  });

  it("TC-note-780: a lost response to the committed local delete leaves the route purging instead of handing it back", async () => {
    const h = createTestHarness();
    const noteId = await trashedPersonalNote(h);

    await expect(
      purgeNote({
        container: withLostResponseAfterCommit(h, 1),
        input: {
          kind: "userRequest",
          noteId,
          userId: OWNER,
          expectedVersion: 1,
        },
      }),
    ).rejects.toSatisfy(isSystemError);

    // The delete committed and its `note.purged` is already on its way
    // to the fan-out, so reopening the route would leave a row that
    // resolves to a note nothing can produce.
    expect(storedNote(h, noteId)).toBeNull();
    expect(purgedEvents(h)).toHaveLength(1);
    expect(route(h, noteId)?.state).toBe("purging");
    expect(purgeAckKeys(h)).toEqual([]);
  });

  it("TC-note-780: a cleanup purge whose committed delete lost its response resumes on redelivery", async () => {
    const h = createTestHarness();
    const noteId = await createPersonalNote(h);
    await beginCleanup(h);
    // The cleanup path opens the scope twice per attempt: `assertOwner`
    // before the claim, then the transaction that deletes.
    const container = withLostResponseAfterCommit(h, 2);

    await expect(purgeForCleanup(h, noteId, { container })).rejects.toSatisfy(
      isSystemError,
    );
    expect(route(h, noteId)?.state).toBe("purging");

    await purgeForCleanup(h, noteId, { container });

    const operationId = await ownerPurgeOperationId(
      CLEANUP_OPERATION,
      NoteId.create(noteId),
    );
    expect(route(h, noteId)?.state).toBe("tombstone");
    expect(purgeAckKeys(h)).toEqual([`${operationId} ${noteId}`]);
    expect(purgedEvents(h)).toHaveLength(1);
  });

  it("TC-note-780: a resume whose cleanup no longer owns the scope carries the purge forward instead of reopening the route", async () => {
    const h = createTestHarness();
    const noteId = await createPersonalNote(h);
    await beginCleanup(h);

    await expect(
      purgeForCleanup(h, noteId, {
        container: withLostResponseAfterCommit(h, 2),
      }),
    ).rejects.toSatisfy(isSystemError);
    expect(route(h, noteId)?.state).toBe("purging");

    // The barrier is gone by the time the command comes back — the
    // deletion was abandoned, or a later one took the scope.
    await h.container.scopeUnitOfWorkProvider.run(userScope, (ctx) =>
      ctx.cleanupAdmission.abortPersonalAccountDeletion(CLEANUP_OPERATION),
    );

    await purgeForCleanup(h, noteId);

    // Ownership is a reason not to delete, and there is nothing left to
    // not delete: handing the route back here would leave a row pointing
    // at a note whose `note.purged` is already out.
    expect(route(h, noteId)?.state).toBe("tombstone");
    expect(h.backend.publicProjection.get(noteId)).toBeUndefined();
    expect(purgedEvents(h)).toHaveLength(1);
  });

  it("TC-note-351: a cleanup that loses the scope after the entry gate hands back the route of the note it did not delete", async () => {
    const h = createTestHarness();
    const noteId = await createPersonalNote(h);
    await beginCleanup(h);

    await expect(
      purgeForCleanup(h, noteId, { container: losingTheScopeAfter(h, 1) }),
    ).rejects.toSatisfy(isConflictError);

    // The note is still there, so the lost ownership is a decision not
    // to delete — and the route has to be reachable again.
    expect(storedNote(h, noteId)).not.toBeNull();
    expect(route(h, noteId)?.state).toBe("active");
    expect(purgedEvents(h)).toHaveLength(0);
  });

  it("TC-note-354: the route becomes a 30-day tombstone once the public removal is acked", async () => {
    const h = createTestHarness();
    const noteId = await trashedPersonalNote(h);
    const now = h.clock.now();

    await purgeAsUser(h, noteId);

    const row = route(h, noteId);
    expect(row?.state).toBe("tombstone");
    expect(row?.expiresAt).toEqual(
      new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
    );
    expect(h.backend.publicProjection.get(noteId)).toBeUndefined();
  });

  it("TC-note-354: redelivering a finished cleanup purge changes nothing", async () => {
    const h = createTestHarness();
    const noteId = await createPersonalNote(h);
    await beginCleanup(h);
    await purgeForCleanup(h, noteId);
    const acks = purgeAckKeys(h);

    await purgeForCleanup(h, noteId);

    expect(route(h, noteId)?.state).toBe("tombstone");
    expect(purgeAckKeys(h)).toEqual(acks);
    expect(purgedEvents(h)).toHaveLength(1);
  });

  it("TC-note-355: a lost tombstone response re-runs the removal and only then advances", async () => {
    const h = createTestHarness();
    const noteId = await createPersonalNote(h);
    await beginCleanup(h);
    const container = withRouteStore(h, {
      finishPurge: failOnce(
        h.container.noteRouteStore.finishPurge,
        "tombstone response lost",
      ),
    });

    await expect(purgeForCleanup(h, noteId, { container })).rejects.toThrow();
    expect(route(h, noteId)?.state).toBe("purging");

    await purgeForCleanup(h, noteId, { container });

    const operationId = await ownerPurgeOperationId(
      CLEANUP_OPERATION,
      NoteId.create(noteId),
    );
    expect(route(h, noteId)?.state).toBe("tombstone");
    expect(purgeAckKeys(h)).toEqual([`${operationId} ${noteId}`]);
  });

  it("TC-note-356: the note's revisions go with it", async () => {
    const h = createTestHarness();
    const noteId = await createPersonalNote(h);
    seedRevision(h, noteId, {
      id: "revision-1",
      html: "<p>一つ目</p>",
      createdAt: h.clock.now(),
    });
    seedRevision(h, noteId, {
      id: "revision-2",
      html: "<p>二つ目</p>",
      createdAt: h.clock.now(),
    });
    await trash(h, noteId);
    expect(storedRevisions(h, noteId)).toHaveLength(2);

    await purgeAsUser(h, noteId);

    expect(storedRevisions(h, noteId)).toEqual([]);
  });

  it("TC-note-360: a redelivered cleanup purge derives the same internal operation id", async () => {
    const h = createTestHarness();
    const noteId = await createPersonalNote(h);
    await beginCleanup(h);

    await purgeForCleanup(h, noteId);

    const expected = await ownerPurgeOperationId(
      CLEANUP_OPERATION,
      NoteId.create(noteId),
    );
    expect(route(h, noteId)?.operationId).toBe(expected);
    expect(purgedEvents(h)[0]?.payload).toMatchObject({
      operationId: expected,
      deletionOperationId: CLEANUP_OPERATION,
    });
  });

  it("TC-note-360: the derived id is bound to both the deletion and the note", async () => {
    const noteId = NoteId.create("note-1");
    const other = NoteId.create("note-2");

    expect(await ownerPurgeOperationId("op-a", noteId)).not.toBe(
      await ownerPurgeOperationId("op-b", noteId),
    );
    expect(await ownerPurgeOperationId("op-a", noteId)).not.toBe(
      await ownerPurgeOperationId("op-a", other),
    );
    expect(await ownerPurgeOperationId("op-a", noteId)).toBe(
      await ownerPurgeOperationId("op-a", noteId),
    );
  });

  it("TC-note-362: a personal cleanup purges an active note under a closed scope", async () => {
    const h = createTestHarness();
    const noteId = await createPersonalNote(h);
    await beginCleanup(h);
    expect(storedNote(h, noteId)?.lifecycle).toBe("active");

    await purgeForCleanup(h, noteId);

    expect(storedNote(h, noteId)).toBeNull();
    expect(purgedEvents(h)).toHaveLength(1);
    expect(route(h, noteId)?.state).toBe("tombstone");
  });

  it("TC-note-363: a workspace cleanup purges after the workspace and its memberships are gone", async () => {
    const h = createTestHarness();
    await seedWorkspace(h, [{ userId: OWNER, role: "owner" }]);
    const noteId = await createWorkspaceNote(h);
    await beginCleanup(h, workspaceScope);
    h.backend.scope(workspaceScope).workspaces.delete(WORKSPACE);
    for (const membership of h.backend
      .scope(workspaceScope)
      .memberships.values()) {
      h.backend.scope(workspaceScope).memberships.delete(membership.id);
    }

    await purgeForCleanup(h, noteId, { scope: workspaceScope });

    expect(storedNote(h, noteId, workspaceScope)).toBeNull();
    expect(purgedEvents(h)[0]?.payload).toMatchObject({
      owner: { type: "workspace", workspaceId: WorkspaceId.create(WORKSPACE) },
      deletionOperationId: CLEANUP_OPERATION,
    });
  });

  it("TC-note-363: a cleanup command from a foreign operation never closes the route at all", async () => {
    const h = createTestHarness();
    const noteId = await createPersonalNote(h);
    await beginCleanup(h);
    let claims = 0;
    const container = withRouteStore(h, {
      beginPurge: async (input) => {
        claims += 1;
        return h.container.noteRouteStore.beginPurge(input);
      },
    });

    await expect(
      purgeForCleanup(h, noteId, {
        container,
        deletionOperationId: "another-operation",
      }),
    ).rejects.toThrow();

    // Ownership is asked before the claim, so the note is never made
    // unreachable — not even for the moment an abort would take.
    expect(claims).toBe(0);
    expect(storedNote(h, noteId)).not.toBeNull();
    expect(route(h, noteId)?.state).toBe("active");
  });

  it("TC-note-363: ownership lost between the claim and the local delete refuses and hands the route back", async () => {
    const h = createTestHarness();
    const noteId = await createPersonalNote(h);
    await beginCleanup(h);
    const real = h.container.scopeUnitOfWorkProvider;
    let opened = 0;
    const container = {
      ...h.container,
      scopeUnitOfWorkProvider: {
        // The window opens after the route is claimed and before the
        // transaction that would destroy the note: the deletion this
        // command belongs to stops owning the scope in between.
        run: ((scope, body) => {
          opened += 1;
          const interfere =
            opened === 2
              ? real.run(scope, (ctx) =>
                  ctx.cleanupAdmission.abortPersonalAccountDeletion(
                    CLEANUP_OPERATION,
                  ),
                )
              : Promise.resolve();
          return interfere.then(() => real.run(scope, body));
        }) as typeof real.run,
      },
    };

    await expect(purgeForCleanup(h, noteId, { container })).rejects.toThrow();

    expect(storedNote(h, noteId)).not.toBeNull();
    expect(route(h, noteId)?.state).toBe("active");
    expect(purgedEvents(h)).toHaveLength(0);
  });

  it("TC-note-364: an active note is refused with NOTE_NOT_TRASHED and the route is never claimed", async () => {
    const h = createTestHarness();
    const noteId = await createPersonalNote(h);

    await expect(
      purgeAsUser(h, noteId, { expectedVersion: 0 }),
    ).rejects.toSatisfy(
      (error) => isValidationError(error) && error.code === "NOTE_NOT_TRASHED",
    );
    expect(route(h, noteId)?.state).toBe("active");
    expect(storedNote(h, noteId)).not.toBeNull();
  });

  it("TC-note-368: a note restored out of the trash is refused with NOTE_NOT_TRASHED", async () => {
    const h = createTestHarness();
    const noteId = await trashedPersonalNote(h);
    await restoreNote({
      container: h.container,
      input: { noteId, userId: OWNER, expectedVersion: 1 },
    });

    await expect(
      purgeAsUser(h, noteId, { expectedVersion: 2 }),
    ).rejects.toSatisfy(
      (error) => isValidationError(error) && error.code === "NOTE_NOT_TRASHED",
    );
    expect(storedNote(h, noteId)?.lifecycle).toBe("active");
  });

  it("TC-note-369: a workspace viewer is answered NOTE_NOT_FOUND and writes nothing", async () => {
    const h = createTestHarness();
    await seedWorkspace(h, [
      { userId: OWNER, role: "owner" },
      { userId: VIEWER, role: "viewer" },
    ]);
    const noteId = await createWorkspaceNote(h);
    await trash(h, noteId);

    await expect(purgeAsUser(h, noteId, { userId: VIEWER })).rejects.toSatisfy(
      isNotFoundError,
    );
    expect(storedNote(h, noteId, workspaceScope)?.lifecycle).toBe("trashed");
    expect(route(h, noteId)?.state).toBe("active");
  });

  it("TC-note-370: two purges of one note leave one winner and a single note.purged", async () => {
    const h = createTestHarness();
    const noteId = await trashedPersonalNote(h);

    const [first, second] = await Promise.allSettled([
      purgeAsUser(h, noteId),
      purgeAsUser(h, noteId),
    ]);

    const outcomes = [first, second];
    expect(
      outcomes.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    const rejected = outcomes.find((result) => result.status === "rejected");
    expect(rejected?.status === "rejected" ? rejected.reason : null).toSatisfy(
      isNotFoundError,
    );
    expect(purgedEvents(h)).toHaveLength(1);
    expect(storedNote(h, noteId)).toBeNull();
    expect(route(h, noteId)?.state).toBe("tombstone");
  });

  it("a stale expectedVersion is refused and the route is handed back", async () => {
    const h = createTestHarness();
    const noteId = await trashedPersonalNote(h);

    await expect(
      purgeAsUser(h, noteId, { expectedVersion: 0 }),
    ).rejects.toThrow();

    expect(storedNote(h, noteId)?.lifecycle).toBe("trashed");
    expect(route(h, noteId)?.state).toBe("active");
    expect(purgedEvents(h)).toHaveLength(0);
  });
});
