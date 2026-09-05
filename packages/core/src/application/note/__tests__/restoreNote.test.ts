import {
  isNotFoundError,
  isValidationError,
} from "@repo/core/application/errors";
import { noteAccessPolicy } from "@repo/core/application/note/accessControl";
import type { TokenHash } from "@repo/core/domain/identity/valueObject";
import { WorkspaceId } from "@repo/core/domain/workspace/valueObject";
import { describe, expect, it } from "vitest";
import { getNote } from "../getNote";
import { listNotes } from "../listNotes";
import { renameNote } from "../renameNote";
import { restoreNote } from "../restoreNote";
import { trashNote } from "../trashNote";
import {
  createPersonalNote,
  createTestHarness,
  createWorkspaceNote,
  eventsOfType,
  OWNER,
  reseedNote,
  SHARE_TOKEN_HASH,
  seedWorkspace,
  storedNote,
  type TestHarness,
  userScope,
  VIEWER,
  WORKSPACE,
  workspaceScope,
} from "./editingHarness";

const restore = (
  h: TestHarness,
  noteId: string,
  options: Readonly<{ expectedVersion?: number; userId?: string }> = {},
) =>
  restoreNote({
    container: h.container,
    input: {
      noteId,
      userId: options.userId ?? OWNER,
      expectedVersion: options.expectedVersion ?? 1,
    },
  });

const trash = (h: TestHarness, noteId: string, userId: string = OWNER) =>
  trashNote({
    container: h.container,
    input: { noteId, userId, expectedVersion: 0, excludingJobId: null },
  });

describe("restoreNote", () => {
  it("TC-note-463: a trashed public note comes back active with its publication intact", async () => {
    const h = createTestHarness();
    const noteId = await createPersonalNote(h);
    reseedNote(h, noteId, { visibility: "public" });
    await trash(h, noteId);

    const view = await restore(h, noteId);

    expect(view).toEqual({ noteId, version: 2, visibility: "public" });
    const note = storedNote(h, noteId);
    expect(note?.lifecycle).toBe("active");
    expect(note?.version).toBe(2);
    expect(eventsOfType(h, "note.restored")).toHaveLength(1);
    // Created, trashed, restored — the consumer re-reads on each bump.
    expect(h.backend.scope(userScope).projectionRevisions.get(noteId)).toBe(3);
    const anonymous = await getNote({
      container: h.container,
      input: { noteId, userId: null },
    });
    expect(anonymous.visibility).toBe("public");
  });

  it("TC-note-464: a trashed unlisted note is reachable again through the same share link", async () => {
    const h = createTestHarness();
    const noteId = await createPersonalNote(h);
    reseedNote(h, noteId, { visibility: "unlisted" });
    const before = storedNote(h, noteId);
    await trash(h, noteId);

    const view = await restore(h, noteId);

    expect(view.visibility).toBe("unlisted");
    const after = storedNote(h, noteId);
    expect(after?.visibility).toEqual(before?.visibility);
    expect(
      after === null
        ? null
        : noteAccessPolicy.evaluate(
            after,
            { kind: "anonymous" },
            { tokenHash: SHARE_TOKEN_HASH as TokenHash, pass: null },
            h.clock.now(),
          ).kind,
    ).toBe("granted");
  });

  it("TC-note-465: restoring changes nothing but the lifecycle, so what hung off the note comes back with it", async () => {
    const h = createTestHarness();
    const noteId = await createPersonalNote(h);
    const before = storedNote(h, noteId);
    await trash(h, noteId);

    await restore(h, noteId);

    const after = storedNote(h, noteId);
    expect(after?.lifecycle).toBe("active");
    expect(after?.id).toBe(before?.id);
    expect(after?.title).toEqual(before?.title);
    expect(after?.content).toEqual(before?.content);
    expect(after?.styleMode).toBe(before?.styleMode);
  });

  it("TC-note-814: the response carries the version the restore left, so the screen's next save is not a guess", async () => {
    const h = createTestHarness();
    const noteId = await createPersonalNote(h);
    await trash(h, noteId);

    const view = await restore(h, noteId);

    expect(view.version).toBe(storedNote(h, noteId)?.version);
    await expect(
      renameNote({
        container: h.container,
        input: {
          noteId,
          userId: OWNER,
          title: "戻したあとの題",
          expectedVersion: view.version,
        },
      }),
    ).resolves.toMatchObject({ noteId });
  });

  it("TC-note-466: a note that is not in the trash is refused with NOTE_NOT_TRASHED", async () => {
    const h = createTestHarness();
    const noteId = await createPersonalNote(h);

    await expect(restore(h, noteId, { expectedVersion: 0 })).rejects.toSatisfy(
      (error) => isValidationError(error) && error.code === "NOTE_NOT_TRASHED",
    );
    expect(storedNote(h, noteId)?.version).toBe(0);
    expect(eventsOfType(h, "note.restored")).toHaveLength(0);
  });

  it("TC-note-467: a workspace viewer is answered NOTE_NOT_FOUND and writes nothing", async () => {
    const h = createTestHarness();
    await seedWorkspace(h, [
      { userId: OWNER, role: "owner" },
      { userId: VIEWER, role: "viewer" },
    ]);
    const noteId = await createWorkspaceNote(h);
    await trash(h, noteId);

    await expect(restore(h, noteId, { userId: VIEWER })).rejects.toSatisfy(
      isNotFoundError,
    );
    const note = storedNote(h, noteId, workspaceScope);
    expect(note?.lifecycle).toBe("trashed");
    expect(note?.version).toBe(1);
  });

  it("TC-note-468: a restored note is back in the active listing", async () => {
    const h = createTestHarness();
    const noteId = await createPersonalNote(h);
    await trash(h, noteId);
    const hidden = await listNotes({
      container: h.container,
      input: { userId: OWNER },
    });
    expect(hidden.items).toEqual([]);

    await restore(h, noteId);

    const list = await listNotes({
      container: h.container,
      input: { userId: OWNER },
    });
    expect(list.items.map((item) => item.noteId)).toEqual([noteId]);
  });

  it("TC-note-469: a note whose workspace is gone is answered NOTE_NOT_FOUND", async () => {
    const h = createTestHarness();
    await seedWorkspace(h, [{ userId: OWNER, role: "owner" }]);
    const noteId = await createWorkspaceNote(h);
    await trash(h, noteId);
    h.backend
      .scope(workspaceScope)
      .workspaces.delete(WorkspaceId.create(WORKSPACE));

    await expect(restore(h, noteId)).rejects.toSatisfy(isNotFoundError);
    expect(storedNote(h, noteId, workspaceScope)?.lifecycle).toBe("trashed");
  });
});
