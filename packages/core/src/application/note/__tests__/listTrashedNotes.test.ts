import type { ScopeKey } from "@repo/core/application/scope";
import { UserId } from "@repo/core/domain/identity/valueObject";
import { Note } from "@repo/core/domain/note/note";
import { NoteOwner } from "@repo/core/domain/note/valueObject";
import { WorkspaceErrorCode } from "@repo/core/domain/workspace/errorCode";
import { describe, expect, it } from "vitest";
import {
  expectBusinessRule,
  expectNotFound,
} from "../../workspace/__tests__/harness";
import { listTrashedNotes } from "../listTrashedNotes";
import { trashNote } from "../trashNote";
import {
  createPersonalNote,
  createTestHarness,
  createWorkspaceNote,
  MEMBER,
  OWNER,
  seedWorkspace,
  type TestHarness,
  userScope,
  VIEWER,
  WORKSPACE,
} from "./editingHarness";

const DAY_MS = 24 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

const list = (
  h: TestHarness,
  input: Readonly<{
    userId?: string;
    workspaceId?: string;
    page?: number;
    limit?: number;
  }> = {},
) =>
  listTrashedNotes({
    container: h.container,
    input:
      input.workspaceId === undefined
        ? {
            userId: input.userId ?? OWNER,
            ...(input.page !== undefined ? { page: input.page } : {}),
            ...(input.limit !== undefined ? { limit: input.limit } : {}),
          }
        : {
            userId: input.userId ?? OWNER,
            ownerType: "workspace",
            ownerWorkspaceId: input.workspaceId,
            ...(input.page !== undefined ? { page: input.page } : {}),
            ...(input.limit !== undefined ? { limit: input.limit } : {}),
          },
  });

const trash = (h: TestHarness, noteId: string, userId = OWNER) =>
  trashNote({
    container: h.container,
    input: { noteId, userId, expectedVersion: 0, excludingJobId: null },
  });

/**
 * Trashes each note a minute apart so `updatedAt DESC` is what the
 * assertion reads, not the `id DESC` tiebreak underneath it.
 */
async function trashPersonalNotesInOrder(
  h: TestHarness,
  count: number,
): Promise<readonly string[]> {
  const ids: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const noteId = await createPersonalNote(h);
    ids.push(noteId);
  }
  for (const noteId of ids) {
    await trash(h, noteId);
    h.clock.advance(MINUTE_MS);
  }
  return ids;
}

/**
 * Writes trashed rows straight into the scope's table. Reaching the
 * `limit` ceiling through `createBlankNote` + `trashNote` would only make
 * the case slower, not more faithful.
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

describe("listTrashedNotes", () => {
  it("PAGE-p14-001: orders the trash by deletion time, newest first", async () => {
    const h = createTestHarness();
    const [first, second, third] = await trashPersonalNotesInOrder(h, 3);

    const view = await list(h);

    expect(view.count).toBe(3);
    expect(view.items.map((item) => item.noteId)).toEqual([
      third,
      second,
      first,
    ]);
  });

  it("PAGE-p14-002/003: carries the version and the purge deadline every row's actions need", async () => {
    const h = createTestHarness();
    const trashedAt = h.clock.now();
    const noteId = await createPersonalNote(h);
    await trash(h, noteId);

    const view = await list(h);

    expect(view.items).toHaveLength(1);
    expect(view.items[0]).toEqual({
      noteId,
      title: "無題",
      version: 1,
      trashedAt,
      purgeAfter: new Date(trashedAt.getTime() + 30 * DAY_MS),
    });
  });

  it("PAGE-p14-001: shows only the trash, never the owner's active notes", async () => {
    const h = createTestHarness();
    const kept = await createPersonalNote(h);
    const removed = await createPersonalNote(h);
    await trash(h, removed);

    const view = await list(h);

    expect(view.count).toBe(1);
    expect(view.items.map((item) => item.noteId)).toEqual([removed]);
    expect(view.items.map((item) => item.noteId)).not.toContain(kept);
  });

  it("PAGE-p14-001: answers an empty trash with a zero count", async () => {
    const h = createTestHarness();
    await createPersonalNote(h);

    await expect(list(h)).resolves.toEqual({ items: [], count: 0 });
  });

  it("PAGE-p14-001: does not reach another user's trash", async () => {
    const h = createTestHarness();
    const mine = await createPersonalNote(h);
    await trash(h, mine);

    await expect(list(h, { userId: "someone-else" })).resolves.toEqual({
      items: [],
      count: 0,
    });
  });

  it("PAGE-p14-001: pages the trash while reporting the whole count", async () => {
    const h = createTestHarness();
    const [first, second, third] = await trashPersonalNotesInOrder(h, 3);

    const page1 = await list(h, { page: 1, limit: 2 });
    const page2 = await list(h, { page: 2, limit: 2 });

    expect(page1.count).toBe(3);
    expect(page1.items.map((item) => item.noteId)).toEqual([third, second]);
    expect(page2.count).toBe(3);
    expect(page2.items.map((item) => item.noteId)).toEqual([first]);
  });

  it("PAGE-p14-001: caps an oversized limit at 100 rows per page", async () => {
    const h = createTestHarness();
    seedTrashedNotes(h, 101);

    const view = await list(h, { limit: 1000 });

    expect(view.count).toBe(101);
    expect(view.items).toHaveLength(100);
  });

  it("PAGE-p14-001: reads the first page for a page number below one", async () => {
    const h = createTestHarness();
    const [first, second] = await trashPersonalNotesInOrder(h, 2);

    const view = await list(h, { page: 0, limit: 1 });

    expect(view.items.map((item) => item.noteId)).toEqual([second]);
    expect(view.items.map((item) => item.noteId)).not.toContain(first);
  });

  it("PAGE-p14-001: lists the workspace trash for an editor, not the editor's personal trash", async () => {
    const h = createTestHarness();
    await seedWorkspace(h, [
      { userId: OWNER, role: "owner" },
      { userId: MEMBER, role: "editor" },
    ]);
    const shared = await createWorkspaceNote(h);
    await trash(h, shared);
    const personal = await createPersonalNote(h);
    await trash(h, personal);

    const view = await list(h, { userId: MEMBER, workspaceId: WORKSPACE });

    expect(view.count).toBe(1);
    expect(view.items.map((item) => item.noteId)).toEqual([shared]);
  });

  // L-01: `viewTrash` needs editor, so a viewer must not reach the
  // listing at all — the trash entry is not shown to them either.
  it("PAGE-p14-001: refuses a workspace viewer with InsufficientRole", async () => {
    const h = createTestHarness();
    await seedWorkspace(h, [
      { userId: OWNER, role: "owner" },
      { userId: VIEWER, role: "viewer" },
    ]);
    const shared = await createWorkspaceNote(h);
    await trash(h, shared);

    await expectBusinessRule(
      list(h, { userId: VIEWER, workspaceId: WORKSPACE }),
      WorkspaceErrorCode.InsufficientRole,
    );
  });

  it("PAGE-p14-001: refuses a non-member with InsufficientRole", async () => {
    const h = createTestHarness();
    await seedWorkspace(h, [{ userId: OWNER, role: "owner" }]);

    await expectBusinessRule(
      list(h, { userId: "outsider", workspaceId: WORKSPACE }),
      WorkspaceErrorCode.InsufficientRole,
    );
  });

  it("PAGE-p14-001: answers WORKSPACE_NOT_FOUND for a workspace that is not there", async () => {
    const h = createTestHarness();

    await expectNotFound(
      list(h, { workspaceId: "no-such-workspace" }),
      "WORKSPACE_NOT_FOUND",
    );
  });
});
