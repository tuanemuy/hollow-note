import { isNotFoundError } from "@repo/core/application/errors";
import { ScopeKey } from "@repo/core/application/scope";
import { isBusinessRuleError } from "@repo/core/domain/error";
import { UserId } from "@repo/core/domain/identity/valueObject";
import { NoteErrorCode } from "@repo/core/domain/note/errorCode";
import { Note } from "@repo/core/domain/note/note";
import { NoteId, NoteOwner } from "@repo/core/domain/note/valueObject";
import { WorkspaceErrorCode } from "@repo/core/domain/workspace/errorCode";
import { Membership } from "@repo/core/domain/workspace/membership";
import { WorkspaceId } from "@repo/core/domain/workspace/valueObject";
import { Workspace } from "@repo/core/domain/workspace/workspace";
import { describe, expect, it } from "vitest";
import { createTestHarness, type TestHarness } from "../../__tests__/helpers";
import { createBlankNote, recoverBlankNoteCreation } from "../createBlankNote";

const USER = "user-1";
const WORKSPACE = "workspace-1";
const scope = ScopeKey.user(UserId.create(USER));
const workspaceScope = ScopeKey.workspace(WorkspaceId.create(WORKSPACE));

const create = (h: TestHarness, title: string | null = null) =>
  createBlankNote({
    container: h.container,
    input: { userId: USER, ownerType: "user", title },
  });

const createInWorkspace = (h: TestHarness) =>
  createBlankNote({
    container: h.container,
    input: {
      userId: USER,
      ownerType: "workspace",
      ownerWorkspaceId: WORKSPACE,
      title: null,
    },
  });

const storedNote = (h: TestHarness, noteId: string) =>
  h.backend.scope(scope).notes.get(noteId) ?? null;

/** Seeds a workspace holding one membership, without its saga. */
async function seedWorkspaceMember(
  h: TestHarness,
  role: "owner" | "editor" | "viewer" | null,
): Promise<void> {
  const workspaceId = WorkspaceId.create(WORKSPACE);
  const now = h.clock.now();
  await h.container.scopeUnitOfWorkProvider.run(workspaceScope, async (ctx) => {
    await ctx.workspaceRepository.insert(
      Workspace.create(
        {
          id: WORKSPACE,
          ownerId: UserId.create("founder-1"),
          name: "Workspace",
          description: "",
          slug: null,
        },
        now,
      ).entity,
    );
    if (role !== null) {
      await ctx.membershipRepository.insert(
        Membership.create(
          {
            id: "membership-1",
            workspaceId,
            userId: UserId.create(USER),
            role,
          },
          now,
        ).entity,
      );
    }
  });
}

const expectInsufficientRole = (promise: Promise<unknown>) =>
  expect(promise).rejects.toSatisfy(
    (error) =>
      isBusinessRuleError(error) &&
      error.code === WorkspaceErrorCode.InsufficientRole,
  );

describe("createBlankNote", () => {
  it("TC-note-054: creates a private, empty-ready note and emits note.created", async () => {
    const h = createTestHarness();
    const view = await create(h);

    expect(view).toMatchObject({
      ownerType: "user",
      ownerId: USER,
      visibility: "private",
      styleMode: "default",
    });

    const note = storedNote(h, view.noteId);
    expect(note?.lifecycle).toBe("active");
    expect(note?.visibility.status).toBe("private");
    expect(note?.content).toMatchObject({ status: "ready", html: "" });

    const createdEvents = h.backend.outbox
      .values()
      .filter((row) => row.type === "note.created");
    expect(createdEvents).toHaveLength(1);
    expect(createdEvents[0]?.payload).toMatchObject({
      noteId: view.noteId,
      createdBy: USER,
      sourceFileId: null,
      projectionRevision: 1,
    });

    const route = await h.container.noteRouteStore.resolve(
      NoteId.create(view.noteId),
    );
    expect(route?.state).toBe("active");
  });

  it("TC-note-055: an editor creates a workspace-owned note in the workspace scope", async () => {
    const h = createTestHarness();
    await seedWorkspaceMember(h, "editor");

    const view = await createInWorkspace(h);

    expect(view).toMatchObject({ ownerType: "workspace", ownerId: WORKSPACE });
    const note = h.backend.scope(workspaceScope).notes.get(view.noteId);
    expect(note?.owner).toEqual({ type: "workspace", workspaceId: WORKSPACE });
    expect(h.backend.scope(scope).notes.size).toBe(0);

    const route = await h.container.noteRouteStore.resolve(
      NoteId.create(view.noteId),
    );
    expect(route?.state).toBe("active");
    // The route keeps the author, not the owning workspace.
    expect(route?.createdBy).toBe(USER);
  });

  it("TC-note-056: a viewer cannot create a workspace-owned note", async () => {
    const h = createTestHarness();
    await seedWorkspaceMember(h, "viewer");

    await expectInsufficientRole(createInWorkspace(h));
    expect(h.backend.noteRoutes.size).toBe(0);
    expect(h.backend.scope(workspaceScope).notes.size).toBe(0);
  });

  it("TC-note-057: a non-member cannot create a workspace-owned note", async () => {
    const h = createTestHarness();
    await seedWorkspaceMember(h, null);

    await expectInsufficientRole(createInWorkspace(h));
    expect(h.backend.noteRoutes.size).toBe(0);
  });

  it("TC-note-058: an omitted title becomes 無題 with an auto origin", async () => {
    const h = createTestHarness();
    const view = await create(h, null);
    expect(view.title).toBe("無題");
    expect(storedNote(h, view.noteId)?.title).toEqual({
      value: "無題",
      origin: "auto",
    });
  });

  it("TC-note-059: a supplied title is kept with a manual origin", async () => {
    const h = createTestHarness();
    const view = await create(h, "会議メモ");
    expect(view.title).toBe("会議メモ");
    expect(storedNote(h, view.noteId)?.title).toEqual({
      value: "会議メモ",
      origin: "manual",
    });
  });

  it("TC-note-060: a 201-character title is rejected as InvalidTitle", async () => {
    const h = createTestHarness();
    await expect(create(h, "あ".repeat(201))).rejects.toSatisfy(
      (error) =>
        isBusinessRuleError(error) && error.code === NoteErrorCode.InvalidTitle,
    );
    expect(h.backend.noteRoutes.size).toBe(0);
  });

  it("TC-note-061: an unknown workspace id resolves to WORKSPACE_NOT_FOUND", async () => {
    const h = createTestHarness();
    await expect(
      createBlankNote({
        container: h.container,
        input: {
          userId: USER,
          ownerType: "workspace",
          ownerWorkspaceId: "ws-nonexistent",
          title: null,
        },
      }),
    ).rejects.toSatisfy(
      (error) => isNotFoundError(error) && error.code === "WORKSPACE_NOT_FOUND",
    );
  });

  it("TC-note-062: a fresh note starts with styleMode default", async () => {
    const h = createTestHarness();
    const view = await create(h);
    expect(view.styleMode).toBe("default");
    expect(storedNote(h, view.noteId)?.styleMode).toBe("default");
  });

  it("TC-note-063: a failed scope-local commit releases the reserved route so the note is unreachable", async () => {
    const h = createTestHarness();
    const failing = {
      ...h.container,
      scopeUnitOfWorkProvider: {
        run: () => Promise.reject(new Error("commit failed")),
      },
    };
    await expect(
      createBlankNote({
        container: failing,
        input: {
          userId: USER,
          ownerType: "user",
          title: null,
        },
      }),
    ).rejects.toThrow("commit failed");

    expect(h.backend.noteRoutes.size).toBe(0);
    expect(h.backend.scope(scope).notes.size).toBe(0);
  });

  it("TC-note-064: a lost activation response retries with the same operation id and never duplicates the note", async () => {
    const h = createTestHarness();
    let activateCalls = 0;
    const flaky = {
      ...h.container,
      noteRouteStore: {
        ...h.container.noteRouteStore,
        async activateCreate(
          input: Parameters<
            typeof h.container.noteRouteStore.activateCreate
          >[0],
        ) {
          activateCalls += 1;
          if (activateCalls === 1) {
            await h.container.noteRouteStore.activateCreate(input);
            throw new Error("response lost");
          }
          return h.container.noteRouteStore.activateCreate(input);
        },
      },
    };
    const view = await createBlankNote({
      container: flaky,
      input: {
        userId: USER,
        ownerType: "user",
        title: null,
      },
    });
    expect(activateCalls).toBe(2);
    expect(h.backend.scope(scope).notes.size).toBe(1);
    const route = await h.container.noteRouteStore.resolve(
      NoteId.create(view.noteId),
    );
    expect(route?.state).toBe("active");
  });

  it("TC-note-065: recovery of an expired reserved route activates when the note exists and abandons otherwise", async () => {
    const h = createTestHarness();
    const now = h.clock.now();
    const userId = UserId.create(USER);

    // Case A: the scope commit landed but activation never happened.
    const committedId = NoteId.create("note-committed");
    await h.container.noteRouteStore.reserveCreate({
      noteId: committedId,
      scope,
      createdBy: userId,
      operationId: "op-committed",
      expiresAt: new Date(now.getTime() - 1),
    });
    await h.container.scopeUnitOfWorkProvider.run(scope, async (ctx) => {
      const created = Note.createBlank(
        {
          id: committedId,
          owner: NoteOwner.user(userId),
          createdBy: userId,
          title: "",
          projectionRevision: 1,
        },
        now,
      );
      await ctx.noteRepository.insert(created.entity);
    });
    const recovered = await recoverBlankNoteCreation({
      container: h.container,
      input: {
        noteId: committedId,
        operationId: "op-committed",
        ownerType: "user",
        ownerId: USER,
      },
    });
    expect(recovered.outcome).toBe("activated");
    expect((await h.container.noteRouteStore.resolve(committedId))?.state).toBe(
      "active",
    );

    // Case B: the commit never landed — the reservation is deleted.
    const abandonedId = NoteId.create("note-abandoned");
    await h.container.noteRouteStore.reserveCreate({
      noteId: abandonedId,
      scope,
      createdBy: userId,
      operationId: "op-abandoned",
      expiresAt: new Date(now.getTime() - 1),
    });
    const abandoned = await recoverBlankNoteCreation({
      container: h.container,
      input: {
        noteId: abandonedId,
        operationId: "op-abandoned",
        ownerType: "user",
        ownerId: USER,
      },
    });
    expect(abandoned.outcome).toBe("abandoned");
    expect(
      h.backend.noteRoutes.values().find((row) => row.noteId === abandonedId),
    ).toBeUndefined();
  });

  it("TC-identity-045: a note created after the deletion barrier is refused", async () => {
    const h = createTestHarness();
    await h.container.scopeUnitOfWorkProvider.run(scope, (ctx) =>
      ctx.cleanupAdmission.beginPersonalAccountDeletion(
        "deletion-1",
        UserId.create(USER),
      ),
    );

    await expect(create(h)).rejects.toSatisfy(
      (error: unknown) =>
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "ACCOUNT_DELETING",
    );
  });
});
