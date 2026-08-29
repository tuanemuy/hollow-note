import { isNotFoundError } from "@repo/core/application/errors";
import { ScopeKey } from "@repo/core/application/scope";
import { UserId } from "@repo/core/domain/identity/valueObject";
import { Note } from "@repo/core/domain/note/note";
import {
  NoteId,
  NoteOwner,
  ShareLink,
} from "@repo/core/domain/note/valueObject";
import { Membership } from "@repo/core/domain/workspace/membership";
import { WorkspaceId } from "@repo/core/domain/workspace/valueObject";
import { Workspace } from "@repo/core/domain/workspace/workspace";
import { describe, expect, it } from "vitest";
import {
  createTestHarness,
  TEST_APP_URL,
  type TestHarness,
} from "../../__tests__/helpers";
import { createBlankNote } from "../createBlankNote";
import { getNote } from "../getNote";
import { emptyReferenceReport } from "../view";

const OWNER = "owner-1";
const OTHER = "other-1";
const WORKSPACE = "workspace-1";
const ownerScope = ScopeKey.user(UserId.create(OWNER));
const workspaceScope = ScopeKey.workspace(WorkspaceId.create(WORKSPACE));

const expectNoteNotFound = (promise: Promise<unknown>) =>
  expect(promise).rejects.toSatisfy(
    (error) => isNotFoundError(error) && error.code === "NOTE_NOT_FOUND",
  );

let seedCounter = 0;

/** Routes + inserts a note snapshot into the owner's scope. */
async function seedNote(
  h: TestHarness,
  overrides: Partial<Parameters<typeof Note.reconstruct>[0]> = {},
): Promise<NoteId> {
  seedCounter += 1;
  const id = `seeded-note-${seedCounter}`;
  const now = h.clock.now();
  const note = Note.reconstruct({
    id,
    ownerType: "user",
    ownerId: OWNER,
    createdBy: OWNER,
    title: "Seeded note",
    titleOrigin: "manual",
    contentStatus: "ready",
    html: "<p>Hello</p>",
    text: "Hello",
    excerpt: "Hello",
    headings: [{ level: 2, text: "Intro", anchorId: "intro" }],
    visibilityStatus: "private",
    styleMode: "default",
    lifecycle: "active",
    version: 3,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  });
  const noteId = NoteId.create(id);
  await h.container.noteRouteStore.reserveCreate({
    noteId,
    scope: ownerScope,
    createdBy: UserId.create(OWNER),
    operationId: `seed-op-${seedCounter}`,
    expiresAt: new Date(now.getTime() + 60_000),
  });
  await h.container.scopeUnitOfWorkProvider.run(ownerScope, async (ctx) => {
    await ctx.noteRepository.insert(note);
  });
  await h.container.noteRouteStore.activateCreate({
    noteId,
    operationId: `seed-op-${seedCounter}`,
  });
  return noteId;
}

const get = (h: TestHarness, noteId: string, userId: string | null) =>
  getNote({ container: h.container, input: { noteId, userId } });

/**
 * Routes + inserts a workspace-owned note, together with the workspace
 * and the viewer's membership the access decision is read from.
 */
async function seedWorkspaceNote(
  h: TestHarness,
  params: Readonly<{
    role: "owner" | "editor" | "viewer" | null;
    trashed?: boolean;
  }>,
): Promise<NoteId> {
  seedCounter += 1;
  const id = `workspace-note-${seedCounter}`;
  const now = h.clock.now();
  const workspaceId = WorkspaceId.create(WORKSPACE);
  const noteId = NoteId.create(id);
  const trashed = params.trashed ?? false;
  const note = Note.reconstruct({
    id,
    ownerType: "workspace",
    ownerId: WORKSPACE,
    createdBy: OWNER,
    title: "Workspace note",
    titleOrigin: "manual",
    contentStatus: "ready",
    html: "<p>Hello</p>",
    text: "Hello",
    excerpt: "Hello",
    headings: [],
    visibilityStatus: "private",
    styleMode: "default",
    lifecycle: trashed ? "trashed" : "active",
    ...(trashed
      ? {
          trashedAt: now,
          purgeAfter: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
        }
      : {}),
    version: 3,
    createdAt: now,
    updatedAt: now,
  });
  await h.container.noteRouteStore.reserveCreate({
    noteId,
    scope: workspaceScope,
    createdBy: UserId.create(OWNER),
    operationId: `seed-op-${seedCounter}`,
    expiresAt: new Date(now.getTime() + 60_000),
  });
  await h.container.scopeUnitOfWorkProvider.run(workspaceScope, async (ctx) => {
    await ctx.noteRepository.insert(note);
    await ctx.workspaceRepository.insert(
      Workspace.create(
        {
          id: WORKSPACE,
          ownerId: UserId.create(OWNER),
          name: "Workspace",
          description: "",
          slug: null,
        },
        now,
      ).entity,
    );
    if (params.role !== null) {
      await ctx.membershipRepository.insert(
        Membership.create(
          {
            id: `membership-${seedCounter}`,
            workspaceId,
            userId: UserId.create(OTHER),
            role: params.role,
          },
          now,
        ).entity,
      );
    }
  });
  await h.container.noteRouteStore.activateCreate({
    noteId,
    operationId: `seed-op-${seedCounter}`,
  });
  return noteId;
}

describe("getNote", () => {
  it("TC-note-165: the owner's note returns body, headings, visibility, and full permissions", async () => {
    const h = createTestHarness();
    const noteId = await seedNote(h);
    const view = await get(h, noteId, OWNER);

    expect(view.title).toBe("Seeded note");
    expect(view.content).toEqual({
      status: "ready",
      html: "<p>Hello</p>",
      failureReason: null,
    });
    expect(view.headings).toEqual([
      { level: 2, text: "Intro", anchorId: "intro" },
    ]);
    expect(view.visibility).toBe("private");
    expect(view.permissions).toEqual({
      canEdit: true,
      canDelete: true,
      canChangeVisibility: true,
    });
    // Deliberately no assertion on `references` content here: the report
    // is structurally empty in this slice.
  });

  it("TC-note-166: a workspace viewer reads the body with no permissions", async () => {
    const h = createTestHarness();
    const noteId = await seedWorkspaceNote(h, { role: "viewer" });

    const view = await get(h, noteId, OTHER);

    expect(view.content.html).toBe("<p>Hello</p>");
    expect(view.permissions).toEqual({
      canEdit: false,
      canDelete: false,
      canChangeVisibility: false,
    });
  });

  it("TC-note-167: a workspace editor can edit and delete", async () => {
    const h = createTestHarness();
    const noteId = await seedWorkspaceNote(h, { role: "editor" });

    const view = await get(h, noteId, OTHER);

    expect(view.permissions).toEqual({
      canEdit: true,
      canDelete: true,
      canChangeVisibility: true,
    });
  });

  it("a non-member cannot reach a private workspace note", async () => {
    const h = createTestHarness();
    const noteId = await seedWorkspaceNote(h, { role: null });

    await expectNoteNotFound(get(h, noteId, OTHER));
  });

  it("TC-note-174: a workspace viewer cannot reach a trashed workspace note", async () => {
    const h = createTestHarness();
    const noteId = await seedWorkspaceNote(h, {
      role: "viewer",
      trashed: true,
    });

    await expectNoteNotFound(get(h, noteId, OTHER));
  });

  it("TC-note-175: a workspace editor reaches a trashed workspace note", async () => {
    const h = createTestHarness();
    const noteId = await seedWorkspaceNote(h, {
      role: "editor",
      trashed: true,
    });

    expect((await get(h, noteId, OTHER)).noteId).toBe(noteId);
  });

  it("TC-note-168: someone else's private note collapses to NOTE_NOT_FOUND", async () => {
    const h = createTestHarness();
    const noteId = await seedNote(h);
    await expectNoteNotFound(get(h, noteId, OTHER));
  });

  it("TC-note-169: a converting note reports processing with a null body", async () => {
    const h = createTestHarness();
    const noteId = await seedNote(h, {
      contentStatus: "processing",
      html: null,
      text: null,
      excerpt: null,
      headings: [],
    });
    const view = await get(h, noteId, OWNER);
    expect(view.content).toEqual({
      status: "processing",
      html: null,
      failureReason: null,
    });
    expect(view.headings).toEqual([]);
  });

  it("TC-note-170: an LLM-integration-pending note reports awaitingIntegration", async () => {
    const h = createTestHarness();
    const noteId = await seedNote(h, {
      contentStatus: "awaitingIntegration",
      html: null,
      text: null,
      excerpt: null,
      headings: [],
    });
    const view = await get(h, noteId, OWNER);
    expect(view.content.status).toBe("awaitingIntegration");
  });

  it("TC-note-171: a failed conversion reports failed with its reason", async () => {
    const h = createTestHarness();
    const noteId = await seedNote(h, {
      contentStatus: "failed",
      failureReason: "corruptedFile",
      html: null,
      text: null,
      excerpt: null,
      headings: [],
    });
    const view = await get(h, noteId, OWNER);
    expect(view.content).toEqual({
      status: "failed",
      html: null,
      failureReason: "corruptedFile",
    });
  });

  it("TC-note-172: the owner can read a trashed note", async () => {
    const h = createTestHarness();
    const now = h.clock.now();
    const noteId = await seedNote(h, {
      lifecycle: "trashed",
      trashedAt: now,
      purgeAfter: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
    });
    const view = await get(h, noteId, OWNER);
    expect(view.noteId).toBe(noteId);
  });

  it("TC-note-173: someone else's trashed note is NOTE_NOT_FOUND", async () => {
    const h = createTestHarness();
    const now = h.clock.now();
    const noteId = await seedNote(h, {
      lifecycle: "trashed",
      trashedAt: now,
      purgeAfter: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
    });
    await expectNoteNotFound(get(h, noteId, OTHER));
  });

  it("TC-note-176: an unknown note id is NOTE_NOT_FOUND", async () => {
    const h = createTestHarness();
    await expectNoteNotFound(get(h, "no-such-note", OWNER));
  });

  it("TC-note-177: the owner of an unlisted note gets the same shareUrl back via decryption", async () => {
    const h = createTestHarness();
    const created = await createBlankNote({
      container: h.container,
      input: {
        userId: OWNER,
        ownerType: "user",
        ownerWorkspaceId: null,
        title: "Shared",
      },
    });

    // Canonical share token: base64url(NoteId).secret
    const locator = Buffer.from(created.noteId, "utf8").toString("base64url");
    const issued = h.container.secureTokenGenerator.issue();
    const token = `${locator}.${issued.token}`;
    const link = ShareLink.create({
      tokenHash: h.container.secureTokenGenerator.hashOf(token),
      protectedToken: await h.container.shareTokenProtector.protect(token),
      password: null,
      issuedAt: h.clock.now(),
    });
    await h.container.scopeUnitOfWorkProvider.run(ownerScope, async (ctx) => {
      const versioned = await ctx.noteRepository.findById(
        NoteId.create(created.noteId),
      );
      if (versioned === null || !Note.isActive(versioned.entity)) {
        throw new Error("expected the seeded active note");
      }
      const unlisted = Note.makeUnlisted(versioned.entity, link, h.clock.now());
      await ctx.noteRepository.save(unlisted.entity, versioned.expectedVersion);
    });

    const view = await get(h, created.noteId, OWNER);
    expect(view.visibility).toBe("unlisted");
    expect(view.shareUrl).toBe(`${TEST_APP_URL}/s/${token}`);
    expect(view.hasSharePassword).toBe(false);

    // The anonymous / non-owner path never reveals the URL.
    await expectNoteNotFound(get(h, created.noteId, OTHER));
  });

  it("TC-note-178: a public note serves anonymous viewers its body without a shareUrl", async () => {
    const h = createTestHarness();
    const created = await createBlankNote({
      container: h.container,
      input: {
        userId: OWNER,
        ownerType: "user",
        ownerWorkspaceId: null,
        title: "Public",
      },
    });
    await h.container.scopeUnitOfWorkProvider.run(ownerScope, async (ctx) => {
      const versioned = await ctx.noteRepository.findById(
        NoteId.create(created.noteId),
      );
      if (versioned === null || !Note.isActive(versioned.entity)) {
        throw new Error("expected the seeded active note");
      }
      const published = Note.makePublic(versioned.entity, h.clock.now());
      await ctx.noteRepository.save(
        published.entity,
        versioned.expectedVersion,
      );
    });

    const view = await get(h, created.noteId, null);
    expect(view.visibility).toBe("public");
    expect(view.content.status).toBe("ready");
    expect(view.content.html).toBe("");
    expect(view.shareUrl).toBeNull();
    expect(view.permissions).toEqual({
      canEdit: false,
      canDelete: false,
      canChangeVisibility: false,
    });
  });

  it("TC-note-187: a non-ready body yields a structurally empty references report", async () => {
    const h = createTestHarness();
    const processingId = await seedNote(h, {
      contentStatus: "processing",
      html: null,
      text: null,
      excerpt: null,
      headings: [],
    });
    const failedId = await seedNote(h, {
      contentStatus: "failed",
      failureReason: "timeout",
      html: null,
      text: null,
      excerpt: null,
      headings: [],
    });
    const processing = await get(h, processingId, OWNER);
    const failed = await get(h, failedId, OWNER);
    expect(processing.references).toEqual(emptyReferenceReport());
    expect(failed.references).toEqual(emptyReferenceReport());
  });

  it("keeps NoteOwner projection consistent for the DTO", async () => {
    const h = createTestHarness();
    const noteId = await seedNote(h);
    const view = await get(h, noteId, OWNER);
    expect(NoteOwner.user(UserId.create(OWNER))).toEqual({
      type: "user",
      userId: OWNER,
    });
    expect(view.ownerType).toBe("user");
    expect(view.ownerId).toBe(OWNER);
    expect(view.createdBy).toBe(OWNER);
  });
});
