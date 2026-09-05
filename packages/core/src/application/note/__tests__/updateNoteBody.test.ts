import {
  isConflictError,
  isNotFoundError,
} from "@repo/core/application/errors";
import type {
  ScopeUnitOfWorkContext,
  ScopeUnitOfWorkProvider,
} from "@repo/core/application/execution/unitOfWork";
import type { ScopeKey } from "@repo/core/application/scope";
import { isBusinessRuleError } from "@repo/core/domain/error";
import { UserId } from "@repo/core/domain/identity/valueObject";
import { NoteErrorCode } from "@repo/core/domain/note/errorCode";
import { Note } from "@repo/core/domain/note/note";
import { NoteId } from "@repo/core/domain/note/valueObject";
import { WorkspaceId } from "@repo/core/domain/workspace/valueObject";
import { describe, expect, it } from "vitest";
import type { RequestContainer } from "../../di/types";
import { type UpdateNoteBodyInput, updateNoteBody } from "../updateNoteBody";
import {
  createPersonalNote,
  createTestHarness,
  createWorkspaceNote,
  eventsOfType,
  MEMBER,
  OWNER,
  readyBody,
  recordingJobs,
  removeMembership,
  seedWorkspace,
  storedNote,
  storedRevisions,
  type TestHarness,
  userScope,
  VIEWER,
  WORKSPACE,
  workspaceScope,
} from "./editingHarness";

const save = (
  h: TestHarness,
  input: Partial<UpdateNoteBodyInput> &
    Readonly<{ noteId: string; expectedVersion: number }>,
  jobs?: Parameters<typeof updateNoteBody>[0]["jobs"],
) =>
  updateNoteBody({
    container: h.container,
    input: {
      userId: OWNER,
      rawHtml: "<p>body</p>",
      reason: "manualEdit",
      ...input,
    },
    ...(jobs === undefined ? {} : { jobs }),
  });

const versionOf = (h: TestHarness, noteId: string, scope = userScope): number =>
  storedNote(h, noteId, scope)?.version ?? -1;

const EXTERNAL_IMAGE = '<p><img src="https://cdn.example.test/a.png"></p>';
const INTERNAL_IMAGE = '<p><img src="/storage/a.png"></p>';

describe("updateNoteBody", () => {
  it("TC-note-682: saves the sanitized body and captures the previous one as a revision", async () => {
    const h = createTestHarness();
    const noteId = await createPersonalNote(h);

    const first = await save(h, {
      noteId,
      expectedVersion: 0,
      rawHtml: "<h2>Title</h2><p>first</p>",
    });
    expect(readyBody(storedNote(h, noteId))).toContain("<p>first</p>");
    // The blank note's empty body is itself `ready`, so the first save
    // already spends a revision.
    expect(storedRevisions(h, noteId)).toHaveLength(1);
    expect(storedRevisions(h, noteId)[0]?.html).toBe("");

    await save(h, {
      noteId,
      expectedVersion: first.version,
      rawHtml: "<p>second</p>",
    });
    expect(readyBody(storedNote(h, noteId))).toBe("<p>second</p>");
    const revisions = storedRevisions(h, noteId);
    expect(revisions).toHaveLength(2);
    expect(revisions[0]?.html).toContain("<p>first</p>");
    expect(revisions[0]?.reason).toBe("manualEdit");
    expect(eventsOfType(h, "note.contentUpdated").length).toBe(2);
  });

  it("TC-note-741: records the revision reason as wysiwygConversion", async () => {
    const h = createTestHarness();
    const noteId = await createPersonalNote(h);

    await save(h, {
      noteId,
      expectedVersion: 0,
      reason: "wysiwygConversion",
    });

    expect(storedRevisions(h, noteId)[0]?.reason).toBe("wysiwygConversion");
  });

  it("TC-note-725: keeps the newest 20 revisions and drops the oldest", async () => {
    const h = createTestHarness();
    const noteId = await createPersonalNote(h);

    let version = 0;
    for (let index = 0; index < 20; index += 1) {
      h.clock.advance(1000);
      version = (
        await save(h, {
          noteId,
          expectedVersion: version,
          rawHtml: `<p>body ${index}</p>`,
        })
      ).version;
    }
    expect(storedRevisions(h, noteId)).toHaveLength(20);
    const oldest = storedRevisions(h, noteId)[19];

    h.clock.advance(1000);
    await save(h, {
      noteId,
      expectedVersion: version,
      rawHtml: "<p>one more</p>",
    });

    const kept = storedRevisions(h, noteId);
    expect(kept).toHaveLength(20);
    expect(kept.map((revision) => revision.id)).not.toContain(oldest?.id);
    expect(kept[0]?.html).toBe("<p>body 19</p>");
  });

  it("TC-note-721: refuses a body over 800,000 bytes without touching the note", async () => {
    const h = createTestHarness();
    const noteId = await createPersonalNote(h);

    await expect(
      save(h, {
        noteId,
        expectedVersion: 0,
        rawHtml: `<p>${"a".repeat(900_000)}</p>`,
      }),
    ).rejects.toSatisfy(
      (error) =>
        isBusinessRuleError(error) &&
        error.code === NoteErrorCode.ContentTooLarge,
    );
    expect(versionOf(h, noteId)).toBe(0);
    expect(storedRevisions(h, noteId)).toHaveLength(0);
  });

  it("TC-note-723: caps the stored headings at 200 while the save succeeds", async () => {
    const h = createTestHarness();
    const noteId = await createPersonalNote(h);
    const rawHtml = Array.from(
      { length: 201 },
      (_unused, index) => `<h2>Heading ${index}</h2>`,
    ).join("");

    await save(h, { noteId, expectedVersion: 0, rawHtml });

    const note = storedNote(h, noteId);
    expect(note?.content.status).toBe("ready");
    expect(
      note?.content.status === "ready" ? note.content.headings.length : -1,
    ).toBe(200);
  });

  it("TC-note-727: refuses a trashed note with NoteIsTrashed", async () => {
    const h = createTestHarness();
    const noteId = await createPersonalNote(h);
    await h.container.scopeUnitOfWorkProvider.run(userScope, async (ctx) => {
      const stored = await ctx.noteRepository.findById(NoteId.create(noteId));
      if (stored === null || !Note.isActive(stored.entity)) {
        throw new Error("seed failed");
      }
      await ctx.noteRepository.save(
        Note.trash(stored.entity, h.clock.now()).entity,
        stored.expectedVersion,
      );
    });

    await expect(save(h, { noteId, expectedVersion: 1 })).rejects.toSatisfy(
      (error) =>
        isBusinessRuleError(error) &&
        error.code === NoteErrorCode.NoteIsTrashed,
    );
  });

  it("TC-note-731: refuses a stale expectedVersion with OPTIMISTIC_LOCK_FAILURE", async () => {
    const h = createTestHarness();
    const noteId = await createPersonalNote(h);
    await save(h, { noteId, expectedVersion: 0, rawHtml: "<p>a</p>" });

    await expect(
      save(h, { noteId, expectedVersion: 0, rawHtml: "<p>b</p>" }),
    ).rejects.toSatisfy(
      (error) =>
        isConflictError(error) && error.code === "OPTIMISTIC_LOCK_FAILURE",
    );
    expect(readyBody(storedNote(h, noteId))).toBe("<p>a</p>");
  });

  it("TC-note-726: a workspace viewer is answered NOTE_NOT_FOUND", async () => {
    const h = createTestHarness();
    await seedWorkspace(h, [
      { userId: OWNER, role: "owner" },
      { userId: VIEWER, role: "viewer" },
    ]);
    const noteId = await createWorkspaceNote(h);

    await expect(
      save(h, { noteId, expectedVersion: 0, userId: VIEWER }),
    ).rejects.toSatisfy(isNotFoundError);
    expect(versionOf(h, noteId, workspaceScope)).toBe(0);
  });

  it("TC-note-732: a membership removed between the entry read and the write is answered NOTE_NOT_FOUND", async () => {
    const h = createTestHarness();
    await seedWorkspace(h, [
      { userId: OWNER, role: "owner" },
      { userId: MEMBER, role: "editor" },
    ]);
    const noteId = await createWorkspaceNote(h);

    // The interference sits *before* the deciding transaction opens, so
    // an implementation that only checks the role on the entry read
    // (outside the transaction) still writes and fails this case.
    const real = h.container.scopeUnitOfWorkProvider;
    let interfered = false;
    const provider: ScopeUnitOfWorkProvider = {
      async run<T>(
        scope: ScopeKey,
        fn: (ctx: ScopeUnitOfWorkContext) => Promise<T>,
      ): Promise<T> {
        if (!interfered) {
          interfered = true;
          await removeMembership(h, MEMBER);
        }
        return real.run(scope, fn);
      },
    };
    const container: RequestContainer = {
      ...h.container,
      scopeUnitOfWorkProvider: provider,
    };

    await expect(
      updateNoteBody({
        container,
        input: {
          noteId,
          userId: MEMBER,
          rawHtml: "<p>late</p>",
          reason: "manualEdit",
          expectedVersion: 0,
        },
      }),
    ).rejects.toSatisfy(isNotFoundError);
    expect(versionOf(h, noteId, workspaceScope)).toBe(0);
  });

  it("TC-note-728: a running conversion job locks the body", async () => {
    const h = createTestHarness();
    const noteId = await createPersonalNote(h);

    await expect(
      save(
        h,
        { noteId, expectedVersion: 0 },
        recordingJobs([{ jobId: "job-1", kind: "conversion" }]),
      ),
    ).rejects.toSatisfy(
      (error) =>
        isBusinessRuleError(error) &&
        error.code === NoteErrorCode.NoteLockedByJob,
    );
    expect(versionOf(h, noteId)).toBe(0);
  });

  it("TC-note-729: a running regeneration job locks a body that is still ready", async () => {
    const h = createTestHarness();
    const noteId = await createPersonalNote(h);

    await expect(
      save(
        h,
        { noteId, expectedVersion: 0 },
        recordingJobs([{ jobId: "job-1", kind: "regeneration" }]),
      ),
    ).rejects.toSatisfy(
      (error) =>
        isBusinessRuleError(error) &&
        error.code === NoteErrorCode.NoteLockedByJob,
    );
  });

  it("TC-note-730: jobs of other kinds, and terminated ones, do not lock the body", async () => {
    const h = createTestHarness();
    const noteId = await createPersonalNote(h);

    // `listActiveByTarget` only answers unterminated jobs, so a
    // terminated conversion is simply absent from the list; an
    // unterminated job of another kind is the discriminating case.
    const view = await save(
      h,
      { noteId, expectedVersion: 0 },
      recordingJobs([{ jobId: "job-1", kind: "export" }]),
    );

    expect(view.version).toBe(1);
  });

  it("TC-note-733: a new external reference registers a reference-import job", async () => {
    const h = createTestHarness();
    const noteId = await createPersonalNote(h);
    const jobs = recordingJobs();

    const view = await save(
      h,
      {
        noteId,
        expectedVersion: 0,
        rawHtml: EXTERNAL_IMAGE,
        importReferences: true,
      },
      jobs,
    );

    expect(view.referenceImportJobId).toBe("job-reference-import");
    expect(jobs.requests).toHaveLength(1);
  });

  it("TC-note-734: a body with no external reference registers nothing", async () => {
    const h = createTestHarness();
    const noteId = await createPersonalNote(h);
    const jobs = recordingJobs();

    const view = await save(
      h,
      {
        noteId,
        expectedVersion: 0,
        rawHtml: "<p>plain</p>",
        importReferences: true,
      },
      jobs,
    );

    expect(view.referenceImportJobId).toBeNull();
    expect(jobs.requests).toHaveLength(0);
  });

  it("TC-note-735: references that all point at this deployment's storage register nothing", async () => {
    const h = createTestHarness();
    const noteId = await createPersonalNote(h);
    const jobs = recordingJobs();

    const view = await save(
      h,
      {
        noteId,
        expectedVersion: 0,
        rawHtml: INTERNAL_IMAGE,
        importReferences: true,
      },
      jobs,
    );

    expect(view.referenceImportJobId).toBeNull();
    expect(jobs.requests).toHaveLength(0);
  });

  it("TC-note-736 / TC-note-737: an unterminated referenceImport job is reported back without a second registration and without DuplicateJob", async () => {
    const h = createTestHarness();
    const noteId = await createPersonalNote(h);
    const jobs = recordingJobs([
      { jobId: "job-existing", kind: "referenceImport" },
    ]);

    const view = await save(
      h,
      { noteId, expectedVersion: 0, rawHtml: EXTERNAL_IMAGE },
      jobs,
    );

    expect(view.referenceImportJobId).toBe("job-existing");
    expect(jobs.requests).toHaveLength(0);
    expect(readyBody(storedNote(h, noteId))).toContain("cdn.example.test");
  });

  it("TC-note-738: a terminated referenceImport job does not block a new registration", async () => {
    const h = createTestHarness();
    const noteId = await createPersonalNote(h);
    // Terminated jobs never appear in `listActiveByTarget`.
    const jobs = recordingJobs([]);

    const view = await save(
      h,
      { noteId, expectedVersion: 0, rawHtml: EXTERNAL_IMAGE },
      jobs,
    );

    expect(view.referenceImportJobId).toBe("job-reference-import");
    expect(jobs.requests).toHaveLength(1);
  });

  it("TC-note-739: a personal note's import job is scoped to the owning user", async () => {
    const h = createTestHarness();
    const noteId = await createPersonalNote(h);
    const jobs = recordingJobs();

    await save(
      h,
      { noteId, expectedVersion: 0, rawHtml: EXTERNAL_IMAGE },
      jobs,
    );

    expect(jobs.requests[0]?.scope).toEqual({
      type: "user",
      userId: UserId.create(OWNER),
    });
    expect(jobs.requests[0]?.requestedBy).toBe(OWNER);
  });

  it("TC-note-740: a workspace note edited by another member scopes the job to the workspace, not the editor", async () => {
    const h = createTestHarness();
    await seedWorkspace(h, [
      { userId: OWNER, role: "owner" },
      { userId: MEMBER, role: "editor" },
    ]);
    const noteId = await createWorkspaceNote(h);
    const jobs = recordingJobs();

    await save(
      h,
      {
        noteId,
        expectedVersion: 0,
        userId: MEMBER,
        rawHtml: EXTERNAL_IMAGE,
      },
      jobs,
    );

    expect(jobs.requests[0]?.scope).toEqual({
      type: "workspace",
      workspaceId: WorkspaceId.create(WORKSPACE),
    });
    expect(jobs.requests[0]?.requestedBy).toBe(MEMBER);
  });

  it("TC-note-697: a stylesheet trace counts as an external reference and registers the import", async () => {
    const h = createTestHarness();
    const noteId = await createPersonalNote(h);
    const jobs = recordingJobs();

    const view = await save(
      h,
      {
        noteId,
        expectedVersion: 0,
        rawHtml:
          '<link rel="stylesheet" href="https://cdn.example.test/s.css"><p>a</p>',
        importReferences: true,
      },
      jobs,
    );

    expect(readyBody(storedNote(h, noteId))).toContain(
      'data-stylesheet-href="https://cdn.example.test/s.css"',
    );
    expect(view.referenceImportJobId).toBe("job-reference-import");
    expect(view.removed.some((entry) => entry.name === "link")).toBe(true);
  });

  it("TC-note-698: importReferences false keeps the trace untouched and registers nothing", async () => {
    const h = createTestHarness();
    const noteId = await createPersonalNote(h);
    const jobs = recordingJobs();

    const view = await save(
      h,
      {
        noteId,
        expectedVersion: 0,
        rawHtml:
          '<link rel="stylesheet" href="https://cdn.example.test/s.css"><p>a</p>',
        importReferences: false,
      },
      jobs,
    );

    expect(readyBody(storedNote(h, noteId))).toContain(
      'data-stylesheet-href="https://cdn.example.test/s.css"',
    );
    expect(view.referenceImportJobId).toBeNull();
    expect(jobs.requests).toHaveLength(0);
  });

  it("TC-note-699: the trace left behind is importable on a later save", async () => {
    const h = createTestHarness();
    const noteId = await createPersonalNote(h);
    const jobs = recordingJobs();

    const first = await save(
      h,
      {
        noteId,
        expectedVersion: 0,
        rawHtml:
          '<link rel="stylesheet" href="https://cdn.example.test/s.css"><p>a</p>',
        importReferences: false,
      },
      jobs,
    );
    const second = await save(
      h,
      {
        noteId,
        expectedVersion: first.version,
        rawHtml: readyBody(storedNote(h, noteId)),
        importReferences: true,
      },
      jobs,
    );

    expect(second.referenceImportJobId).toBe("job-reference-import");
    expect(jobs.requests).toHaveLength(1);
  });

  it("TC-note-700: importReferences omitted behaves as true", async () => {
    const h = createTestHarness();
    const noteId = await createPersonalNote(h);
    const jobs = recordingJobs();

    const view = await save(
      h,
      { noteId, expectedVersion: 0, rawHtml: EXTERNAL_IMAGE },
      jobs,
    );

    expect(view.referenceImportJobId).toBe("job-reference-import");
    expect(jobs.requests).toHaveLength(1);
  });

  it("TC-note-701: an already-imported stylesheet trace is not extracted again", async () => {
    const h = createTestHarness();
    const noteId = await createPersonalNote(h);
    const jobs = recordingJobs();

    const view = await save(
      h,
      {
        noteId,
        expectedVersion: 0,
        rawHtml:
          '<style data-imported-stylesheet="https://cdn.example.test/s.css">p{color:red;}</style><p>a</p>',
        importReferences: true,
      },
      jobs,
    );

    expect(readyBody(storedNote(h, noteId))).toContain(
      "data-imported-stylesheet",
    );
    expect(view.referenceImportJobId).toBeNull();
    expect(jobs.requests).toHaveLength(0);
  });

  it("TC-note-702: an unavailable stylesheet trace does not re-register the import", async () => {
    const h = createTestHarness();
    const noteId = await createPersonalNote(h);
    const jobs = recordingJobs();

    const view = await save(
      h,
      {
        noteId,
        expectedVersion: 0,
        rawHtml:
          '<style data-stylesheet-unavailable="https://cdn.example.test/s.css"></style><p>a</p>',
        importReferences: true,
      },
      jobs,
    );

    expect(readyBody(storedNote(h, noteId))).toContain(
      "data-stylesheet-unavailable",
    );
    expect(view.referenceImportJobId).toBeNull();
    expect(jobs.requests).toHaveLength(0);
  });
});
