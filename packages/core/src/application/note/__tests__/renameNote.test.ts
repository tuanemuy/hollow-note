import {
  isConflictError,
  isNotFoundError,
} from "@repo/core/application/errors";
import { isBusinessRuleError } from "@repo/core/domain/error";
import { NoteErrorCode } from "@repo/core/domain/note/errorCode";
import { describe, expect, it } from "vitest";
import { renameNote } from "../renameNote";
import {
  createPersonalNote,
  createTestHarness,
  createWorkspaceNote,
  eventsOfType,
  OWNER,
  reseedNote,
  seedWorkspace,
  storedNote,
  type TestHarness,
  VIEWER,
  workspaceScope,
} from "./editingHarness";

const rename = (
  h: TestHarness,
  noteId: string,
  title: string,
  expectedVersion = 0,
  userId: string = OWNER,
) =>
  renameNote({
    container: h.container,
    input: { noteId, userId, title, expectedVersion },
  });

describe("renameNote", () => {
  it("TC-note-398: renames the note, marks the origin manual and emits note.renamed", async () => {
    const h = createTestHarness();
    const noteId = await createPersonalNote(h);

    const view = await rename(h, noteId, "設計メモ");

    expect(view).toEqual({ noteId, title: "設計メモ", version: 1 });
    const note = storedNote(h, noteId);
    expect(note?.title).toEqual({ value: "設計メモ", origin: "manual" });
    const renamed = eventsOfType(h, "note.renamed");
    expect(renamed).toHaveLength(1);
    expect(renamed[0]?.payload).toMatchObject({
      noteId,
      title: { value: "設計メモ", origin: "manual" },
    });
  });

  it("TC-note-399: an empty title folds to 無題 rather than failing", async () => {
    const h = createTestHarness();
    const noteId = await createPersonalNote(h);

    const view = await rename(h, noteId, "");

    expect(view.title).toBe("無題");
    expect(storedNote(h, noteId)?.title.value).toBe("無題");
  });

  it("TC-note-400: a whitespace-only title folds to 無題", async () => {
    const h = createTestHarness();
    const noteId = await createPersonalNote(h);

    const view = await rename(h, noteId, "   \n\t ");

    expect(view.title).toBe("無題");
  });

  it("TC-note-401: a 200-character title is accepted", async () => {
    const h = createTestHarness();
    const noteId = await createPersonalNote(h);
    const title = "あ".repeat(200);

    const view = await rename(h, noteId, title);

    expect(view.title).toBe(title);
    expect(storedNote(h, noteId)?.title.value).toBe(title);
  });

  it("TC-note-402: a 201-character title is refused with InvalidTitle and writes nothing", async () => {
    const h = createTestHarness();
    const noteId = await createPersonalNote(h);

    await expect(rename(h, noteId, "あ".repeat(201))).rejects.toSatisfy(
      (error) =>
        isBusinessRuleError(error) && error.code === NoteErrorCode.InvalidTitle,
    );
    expect(storedNote(h, noteId)?.version).toBe(0);
    expect(eventsOfType(h, "note.renamed")).toHaveLength(0);
  });

  it("TC-note-403: an auto title becomes manual, which is what stops a later conversion from overwriting it", async () => {
    const h = createTestHarness();
    const noteId = await createPersonalNote(h);
    reseedNote(h, noteId, { title: "report.docx", titleOrigin: "auto" });
    expect(storedNote(h, noteId)?.title.origin).toBe("auto");

    await rename(h, noteId, "決算レポート");

    expect(storedNote(h, noteId)?.title.origin).toBe("manual");
  });

  it("TC-note-405: two notes may hold the same title", async () => {
    const h = createTestHarness();
    const first = await createPersonalNote(h);
    const second = await createPersonalNote(h);
    await rename(h, first, "同じ名前");

    const view = await rename(h, second, "同じ名前");

    expect(view.title).toBe("同じ名前");
    expect(storedNote(h, first)?.title.value).toBe("同じ名前");
  });

  it("TC-note-404: a workspace viewer is answered NOTE_NOT_FOUND", async () => {
    const h = createTestHarness();
    await seedWorkspace(h, [
      { userId: OWNER, role: "owner" },
      { userId: VIEWER, role: "viewer" },
    ]);
    const noteId = await createWorkspaceNote(h);

    await expect(rename(h, noteId, "書き換え", 0, VIEWER)).rejects.toSatisfy(
      isNotFoundError,
    );
    expect(storedNote(h, noteId, workspaceScope)?.version).toBe(0);
  });

  it("TC-note-406: a stale expectedVersion is refused with OPTIMISTIC_LOCK_FAILURE", async () => {
    const h = createTestHarness();
    const noteId = await createPersonalNote(h);
    await rename(h, noteId, "一度目");

    await expect(rename(h, noteId, "二度目", 0)).rejects.toSatisfy(
      (error) =>
        isConflictError(error) && error.code === "OPTIMISTIC_LOCK_FAILURE",
    );
    expect(storedNote(h, noteId)?.title.value).toBe("一度目");
  });
});
