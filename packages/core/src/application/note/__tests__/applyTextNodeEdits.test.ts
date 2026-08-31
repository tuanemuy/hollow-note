import {
  isConflictError,
  isNotFoundError,
} from "@repo/core/application/errors";
import { isBusinessRuleError } from "@repo/core/domain/error";
import { NoteErrorCode } from "@repo/core/domain/note/errorCode";
import type { TextNodeEdit } from "@repo/core/domain/note/ports/htmlProcessor";
import { describe, expect, it } from "vitest";
import { applyTextNodeEdits } from "../applyTextNodeEdits";
import { trashNote } from "../trashNote";
import { updateNoteBody } from "../updateNoteBody";
import {
  createPersonalNote,
  createTestHarness,
  createWorkspaceNote,
  OWNER,
  readyBody,
  recordingJobs,
  seedContentStatus,
  seedWorkspace,
  storedNote,
  storedRevisions,
  type TestHarness,
  VIEWER,
  workspaceScope,
} from "./editingHarness";

const BODY =
  '<p class="c">alpha<b>bold</b>omega</p><style>.c{color:red;}</style>';

/** Seeds `BODY` as the note's stored content and returns its version. */
async function seedBody(
  h: TestHarness,
  noteId: string,
  rawHtml: string = BODY,
): Promise<number> {
  const view = await updateNoteBody({
    container: h.container,
    input: {
      noteId,
      userId: OWNER,
      rawHtml,
      reason: "manualEdit",
      expectedVersion: 0,
    },
  });
  return view.version;
}

const apply = (
  h: TestHarness,
  noteId: string,
  edits: readonly TextNodeEdit[],
  expectedVersion: number,
  options: Readonly<{
    userId?: string;
    jobs?: ReturnType<typeof recordingJobs>;
  }> = {},
) =>
  applyTextNodeEdits({
    container: h.container,
    input: {
      noteId,
      userId: options.userId ?? OWNER,
      edits,
      expectedVersion,
    },
    ...(options.jobs === undefined ? {} : { jobs: options.jobs }),
  });

const trash = (h: TestHarness, noteId: string, expectedVersion: number) =>
  trashNote({
    container: h.container,
    input: { noteId, userId: OWNER, expectedVersion, excludingJobId: null },
  });

describe("applyTextNodeEdits", () => {
  it("TC-note-001 / TC-note-013: rewrites the addressed text node and stores a sanitizer output", async () => {
    const h = createTestHarness();
    const noteId = await createPersonalNote(h);
    const version = await seedBody(h, noteId);

    const view = await apply(
      h,
      noteId,
      [{ path: "0.0", expected: "alpha", text: "ALPHA" }],
      version,
    );

    expect(view.skipped).toEqual([]);
    expect(readyBody(storedNote(h, noteId))).toContain(
      '<p class="c">ALPHA<b>bold</b>omega</p>',
    );
    expect(view.version).toBe(version + 1);
  });

  it("TC-note-003: skips an unresolvable path and applies the rest", async () => {
    const h = createTestHarness();
    const noteId = await createPersonalNote(h);
    const version = await seedBody(h, noteId);

    const view = await apply(
      h,
      noteId,
      [
        { path: "9.0", expected: "alpha", text: "ALPHA" },
        { path: "0.2", expected: "omega", text: "OMEGA" },
      ],
      version,
    );

    expect(view.skipped).toEqual([{ path: "9.0", reason: "pathNotFound" }]);
    expect(readyBody(storedNote(h, noteId))).toContain("<b>bold</b>OMEGA");
  });

  it("TC-note-004: skips an edit whose expected text no longer matches", async () => {
    const h = createTestHarness();
    const noteId = await createPersonalNote(h);
    const version = await seedBody(h, noteId);

    const view = await apply(
      h,
      noteId,
      [{ path: "0.0", expected: "stale", text: "ALPHA" }],
      version,
    );

    expect(view.skipped).toEqual([{ path: "0.0", reason: "contentChanged" }]);
    expect(readyBody(storedNote(h, noteId))).toContain("alpha");
  });

  it("TC-note-005: an edit set that lands nowhere succeeds without spending a revision", async () => {
    const h = createTestHarness();
    const noteId = await createPersonalNote(h);
    const version = await seedBody(h, noteId);
    const revisionsBefore = storedRevisions(h, noteId).length;

    const view = await apply(
      h,
      noteId,
      [
        { path: "9.9", expected: "alpha", text: "A" },
        { path: "0.0", expected: "stale", text: "A" },
      ],
      version,
    );

    expect(view.skipped).toHaveLength(2);
    expect(view.version).toBe(version);
    expect(storedNote(h, noteId)?.version).toBe(version);
    expect(storedRevisions(h, noteId)).toHaveLength(revisionsBefore);
  });

  it("TC-note-012: an edit addressing the CSS of a style element is skipped and leaves the stylesheet intact", async () => {
    const h = createTestHarness();
    const noteId = await createPersonalNote(h);
    const version = await seedBody(h, noteId);

    const view = await apply(
      h,
      noteId,
      [
        {
          path: "1.0",
          expected: ".c{color:red;}",
          text: "body{position:fixed;top:0}",
        },
      ],
      version,
    );

    expect(view.skipped).toEqual([{ path: "1.0", reason: "pathNotFound" }]);
    expect(readyBody(storedNote(h, noteId))).toContain(".c{color:red;}");
    expect(readyBody(storedNote(h, noteId))).not.toContain("position:fixed");
  });

  it("TC-note-014: rebuilds excerpt and headings from the edited body", async () => {
    const h = createTestHarness();
    const noteId = await createPersonalNote(h);
    const version = await seedBody(
      h,
      noteId,
      "<h2>Old heading</h2><p>lead</p>",
    );

    await apply(
      h,
      noteId,
      [{ path: "0.0", expected: "Old heading", text: "New heading" }],
      version,
    );

    const content = storedNote(h, noteId)?.content;
    expect(content?.status).toBe("ready");
    if (content?.status !== "ready") {
      throw new Error("unreachable");
    }
    expect(content.headings.map((heading) => heading.text)).toEqual([
      "New heading",
    ]);
    expect(content.excerpt).toContain("New heading");
    expect(content.excerpt).not.toContain("Old heading");
  });

  it("TC-note-017: records the previous body as a manualEdit revision", async () => {
    const h = createTestHarness();
    const noteId = await createPersonalNote(h);
    const version = await seedBody(h, noteId);
    h.clock.advance(1000);

    await apply(
      h,
      noteId,
      [{ path: "0.0", expected: "alpha", text: "ALPHA" }],
      version,
    );

    const newest = storedRevisions(h, noteId)[0];
    expect(newest?.reason).toBe("manualEdit");
    expect(newest?.html).toContain("alpha<b>bold</b>omega");
  });

  it("TC-note-007: a processing body with no running job is refused with CannotCaptureEmptyContent", async () => {
    const h = createTestHarness();
    const noteId = await createPersonalNote(h);
    seedContentStatus(h, noteId, "processing");

    await expect(
      apply(h, noteId, [{ path: "0.0", expected: "a", text: "b" }], 0),
    ).rejects.toSatisfy(
      (error) =>
        isBusinessRuleError(error) &&
        error.code === NoteErrorCode.CannotCaptureEmptyContent,
    );
  });

  it("TC-note-008: an awaitingIntegration or failed body is refused the same way", async () => {
    const h = createTestHarness();
    for (const status of ["awaitingIntegration", "failed"] as const) {
      const noteId = await createPersonalNote(h);
      seedContentStatus(h, noteId, status);

      await expect(
        apply(h, noteId, [{ path: "0.0", expected: "a", text: "b" }], 0),
      ).rejects.toSatisfy(
        (error) =>
          isBusinessRuleError(error) &&
          error.code === NoteErrorCode.CannotCaptureEmptyContent,
      );
    }
  });

  it("TC-note-009: the job check runs before the ready-body check, so a converting note reports NoteLockedByJob", async () => {
    const h = createTestHarness();
    const noteId = await createPersonalNote(h);
    seedContentStatus(h, noteId, "processing");

    await expect(
      apply(h, noteId, [{ path: "0.0", expected: "a", text: "b" }], 0, {
        jobs: recordingJobs([{ jobId: "job-1", kind: "conversion" }]),
      }),
    ).rejects.toSatisfy(
      (error) =>
        isBusinessRuleError(error) &&
        error.code === NoteErrorCode.NoteLockedByJob,
    );
  });

  it("TC-note-010: a running regeneration locks a body that is still ready", async () => {
    const h = createTestHarness();
    const noteId = await createPersonalNote(h);
    const version = await seedBody(h, noteId);

    await expect(
      apply(
        h,
        noteId,
        [{ path: "0.0", expected: "alpha", text: "ALPHA" }],
        version,
        { jobs: recordingJobs([{ jobId: "job-1", kind: "regeneration" }]) },
      ),
    ).rejects.toSatisfy(
      (error) =>
        isBusinessRuleError(error) &&
        error.code === NoteErrorCode.NoteLockedByJob,
    );
    expect(readyBody(storedNote(h, noteId))).toContain("alpha");
  });

  it("TC-note-015: a workspace viewer is answered NOTE_NOT_FOUND", async () => {
    const h = createTestHarness();
    await seedWorkspace(h, [
      { userId: OWNER, role: "owner" },
      { userId: VIEWER, role: "viewer" },
    ]);
    const noteId = await createWorkspaceNote(h);

    await expect(
      apply(h, noteId, [{ path: "0.0", expected: "a", text: "b" }], 0, {
        userId: VIEWER,
      }),
    ).rejects.toSatisfy(isNotFoundError);
    expect(storedNote(h, noteId, workspaceScope)?.version).toBe(0);
  });

  it("TC-note-016: a stale expectedVersion is refused with OPTIMISTIC_LOCK_FAILURE", async () => {
    const h = createTestHarness();
    const noteId = await createPersonalNote(h);
    const version = await seedBody(h, noteId);

    await expect(
      apply(
        h,
        noteId,
        [{ path: "0.0", expected: "alpha", text: "ALPHA" }],
        version - 1,
      ),
    ).rejects.toSatisfy(
      (error) =>
        isConflictError(error) && error.code === "OPTIMISTIC_LOCK_FAILURE",
    );
    expect(readyBody(storedNote(h, noteId))).toContain("alpha");
  });

  it("TC-note-784: refuses a trashed note with NoteIsTrashed", async () => {
    const h = createTestHarness();
    const noteId = await createPersonalNote(h);
    const version = await seedBody(h, noteId);
    await trash(h, noteId, version);

    await expect(
      apply(
        h,
        noteId,
        [{ path: "0.0", expected: "alpha", text: "ALPHA" }],
        version + 1,
      ),
    ).rejects.toSatisfy(
      (error) =>
        isBusinessRuleError(error) &&
        error.code === NoteErrorCode.NoteIsTrashed,
    );
    expect(readyBody(storedNote(h, noteId))).toContain("alpha");
  });
});
