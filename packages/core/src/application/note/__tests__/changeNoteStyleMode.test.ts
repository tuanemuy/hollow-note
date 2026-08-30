import {
  isConflictError,
  isNotFoundError,
} from "@repo/core/application/errors";
import { isBusinessRuleError } from "@repo/core/domain/error";
import { NoteErrorCode } from "@repo/core/domain/note/errorCode";
import { describe, expect, it } from "vitest";
import { changeNoteStyleMode } from "../changeNoteStyleMode";
import { updateNoteBody } from "../updateNoteBody";
import {
  createPersonalNote,
  createTestHarness,
  createWorkspaceNote,
  eventsOfType,
  OWNER,
  seedWorkspace,
  storedNote,
  type TestHarness,
  VIEWER,
  workspaceScope,
} from "./editingHarness";

const change = (
  h: TestHarness,
  noteId: string,
  styleMode: string,
  expectedVersion = 0,
  userId: string = OWNER,
) =>
  changeNoteStyleMode({
    container: h.container,
    input: { noteId, userId, styleMode, expectedVersion },
  });

describe("changeNoteStyleMode", () => {
  it("TC-note-018: switches default to preserve and emits note.styleModeChanged", async () => {
    const h = createTestHarness();
    const noteId = await createPersonalNote(h);
    expect(storedNote(h, noteId)?.styleMode).toBe("default");

    const view = await change(h, noteId, "preserve");

    expect(view).toEqual({ noteId, styleMode: "preserve", version: 1 });
    expect(storedNote(h, noteId)?.styleMode).toBe("preserve");
    const events = eventsOfType(h, "note.styleModeChanged");
    expect(events).toHaveLength(1);
    expect(events[0]?.payload).toMatchObject({
      noteId,
      styleMode: "preserve",
    });
  });

  it("TC-note-019: switches preserve back to default and emits the event again", async () => {
    const h = createTestHarness();
    const noteId = await createPersonalNote(h);
    const first = await change(h, noteId, "preserve");

    const view = await change(h, noteId, "default", first.version);

    expect(view.styleMode).toBe("default");
    expect(storedNote(h, noteId)?.styleMode).toBe("default");
    expect(eventsOfType(h, "note.styleModeChanged")).toHaveLength(2);
  });

  it("TC-note-022 / TC-note-026: setting the mode it already has still writes, bumps the version and emits the event", async () => {
    const h = createTestHarness();
    const noteId = await createPersonalNote(h);

    const view = await change(h, noteId, "default");

    expect(view.styleMode).toBe("default");
    expect(view.version).toBe(1);
    expect(storedNote(h, noteId)?.version).toBe(1);
    expect(eventsOfType(h, "note.styleModeChanged")).toHaveLength(1);
  });

  it("TC-note-023: an unknown mode is refused with InvalidStyleMode before anything is written", async () => {
    const h = createTestHarness();
    const noteId = await createPersonalNote(h);

    await expect(change(h, noteId, "fancy")).rejects.toSatisfy(
      (error) =>
        isBusinessRuleError(error) &&
        error.code === NoteErrorCode.InvalidStyleMode,
    );
    expect(storedNote(h, noteId)?.version).toBe(0);
    expect(eventsOfType(h, "note.styleModeChanged")).toHaveLength(0);
  });

  it("TC-note-024: a workspace viewer is answered NOTE_NOT_FOUND", async () => {
    const h = createTestHarness();
    await seedWorkspace(h, [
      { userId: OWNER, role: "owner" },
      { userId: VIEWER, role: "viewer" },
    ]);
    const noteId = await createWorkspaceNote(h);

    await expect(change(h, noteId, "preserve", 0, VIEWER)).rejects.toSatisfy(
      isNotFoundError,
    );
    expect(storedNote(h, noteId, workspaceScope)?.styleMode).toBe("default");
  });

  it("TC-note-025: a stale expectedVersion is refused with OPTIMISTIC_LOCK_FAILURE", async () => {
    const h = createTestHarness();
    const noteId = await createPersonalNote(h);
    await change(h, noteId, "preserve");

    await expect(change(h, noteId, "default", 0)).rejects.toSatisfy(
      (error) =>
        isConflictError(error) && error.code === "OPTIMISTIC_LOCK_FAILURE",
    );
    expect(storedNote(h, noteId)?.styleMode).toBe("preserve");
  });

  it("TC-note-029: editing the body afterwards leaves the style mode alone", async () => {
    const h = createTestHarness();
    const noteId = await createPersonalNote(h);
    const changed = await change(h, noteId, "preserve");

    await updateNoteBody({
      container: h.container,
      input: {
        noteId,
        userId: OWNER,
        rawHtml: "<p>body</p>",
        reason: "manualEdit",
        expectedVersion: changed.version,
      },
    });

    expect(storedNote(h, noteId)?.styleMode).toBe("preserve");
    expect(eventsOfType(h, "note.styleModeChanged")).toHaveLength(1);
  });
});
