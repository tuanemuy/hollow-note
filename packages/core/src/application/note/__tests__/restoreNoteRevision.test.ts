import {
  isConflictError,
  isNotFoundError,
} from "@repo/core/application/errors";
import { TokenHash } from "@repo/core/domain/identity/valueObject";
import { Note } from "@repo/core/domain/note/note";
import { NoteId, ShareLink } from "@repo/core/domain/note/valueObject";
import { describe, expect, it } from "vitest";
import { restoreNoteRevision } from "../restoreNoteRevision";
import { updateNoteBody } from "../updateNoteBody";
import {
  createPersonalNote,
  createTestHarness,
  createWorkspaceNote,
  eventsOfType,
  OWNER,
  readyBody,
  recordingJobs,
  seedRevision,
  seedWorkspace,
  storedNote,
  storedRevisions,
  type TestHarness,
  userScope,
  VIEWER,
  workspaceScope,
} from "./editingHarness";

const AT = new Date(Date.UTC(2026, 0, 1));

const restore = (
  h: TestHarness,
  noteId: string,
  revisionId: string,
  expectedVersion: number,
  options: Readonly<{
    userId?: string;
    jobs?: ReturnType<typeof recordingJobs>;
  }> = {},
) =>
  restoreNoteRevision({
    container: h.container,
    input: {
      noteId,
      userId: options.userId ?? OWNER,
      revisionId,
      expectedVersion,
    },
    ...(options.jobs === undefined ? {} : { jobs: options.jobs }),
  });

const saveBody = async (
  h: TestHarness,
  noteId: string,
  rawHtml: string,
  expectedVersion: number,
): Promise<number> =>
  (
    await updateNoteBody({
      container: h.container,
      input: {
        noteId,
        userId: OWNER,
        rawHtml,
        reason: "manualEdit",
        expectedVersion,
      },
    })
  ).version;

describe("restoreNoteRevision", () => {
  it("TC-note-470: restores the revision's body, title and style mode", async () => {
    const h = createTestHarness();
    const noteId = await createPersonalNote(h);
    const version = await saveBody(h, noteId, "<p>current</p>", 0);
    seedRevision(h, noteId, {
      id: "revision-old",
      html: "<p>older body</p>",
      createdAt: AT,
      title: "元のタイトル",
      styleMode: "preserve",
    });

    const view = await restore(h, noteId, "revision-old", version);

    const note = storedNote(h, noteId);
    expect(readyBody(note)).toBe("<p>older body</p>");
    expect(note?.title.value).toBe("元のタイトル");
    expect(note?.styleMode).toBe("preserve");
    expect(view.version).toBe(note?.version);
  });

  it("TC-note-471: records the body being replaced as a restore revision", async () => {
    const h = createTestHarness();
    const noteId = await createPersonalNote(h);
    const version = await saveBody(h, noteId, "<p>current</p>", 0);
    seedRevision(h, noteId, {
      id: "revision-old",
      html: "<p>older body</p>",
      createdAt: AT,
    });
    h.clock.advance(60_000);

    await restore(h, noteId, "revision-old", version);

    const newest = storedRevisions(h, noteId)[0];
    expect(newest?.reason).toBe("restore");
    expect(newest?.html).toBe("<p>current</p>");
  });

  it("TC-note-473: an unknown revision id is REVISION_NOT_FOUND and leaves the note alone", async () => {
    const h = createTestHarness();
    const noteId = await createPersonalNote(h);
    const version = await saveBody(h, noteId, "<p>current</p>", 0);

    await expect(
      restore(h, noteId, "revision-missing", version),
    ).rejects.toSatisfy(
      (error) => isNotFoundError(error) && error.code === "REVISION_NOT_FOUND",
    );
    expect(readyBody(storedNote(h, noteId))).toBe("<p>current</p>");
    expect(storedNote(h, noteId)?.version).toBe(version);
  });

  it("TC-note-472: a revision belonging to another note is reported as absent, not applied", async () => {
    const h = createTestHarness();
    const noteId = await createPersonalNote(h);
    const other = await createPersonalNote(h);
    const version = await saveBody(h, noteId, "<p>current</p>", 0);
    seedRevision(h, other, {
      id: "revision-of-other",
      html: "<p>someone else</p>",
      createdAt: AT,
    });

    await expect(
      restore(h, noteId, "revision-of-other", version),
    ).rejects.toSatisfy(
      (error) => isNotFoundError(error) && error.code === "REVISION_NOT_FOUND",
    );
    expect(readyBody(storedNote(h, noteId))).toBe("<p>current</p>");
  });

  it("TC-note-478: the revision's HTML goes through the sanitizer before it is stored", async () => {
    const h = createTestHarness();
    const noteId = await createPersonalNote(h);
    const version = await saveBody(h, noteId, "<p>current</p>", 0);
    // A row that reached storage before a rule was tightened, or through
    // some other producer: restoring must not put it back verbatim.
    seedRevision(h, noteId, {
      id: "revision-unsafe",
      html: '<p onclick="steal()">older</p><script>alert(1)</script>',
      createdAt: AT,
    });

    await restore(h, noteId, "revision-unsafe", version);

    const html = readyBody(storedNote(h, noteId));
    expect(html).toContain("older");
    expect(html).not.toContain("script");
    expect(html).not.toContain("onclick");
  });

  it("TC-note-479: excerpt and headings are rebuilt from the restored body", async () => {
    const h = createTestHarness();
    const noteId = await createPersonalNote(h);
    const version = await saveBody(
      h,
      noteId,
      "<h2>Current heading</h2><p>current</p>",
      0,
    );
    seedRevision(h, noteId, {
      id: "revision-old",
      html: "<h2>Older heading</h2><p>older</p>",
      createdAt: AT,
    });

    await restore(h, noteId, "revision-old", version);

    const content = storedNote(h, noteId)?.content;
    if (content?.status !== "ready") {
      throw new Error("expected a ready body");
    }
    expect(content.headings.map((heading) => heading.text)).toEqual([
      "Older heading",
    ]);
    expect(content.excerpt).toContain("Older heading");
    expect(content.excerpt).not.toContain("Current heading");
  });

  it("TC-note-480 / TC-note-481: restoring a pre-import revision rewinds the references and re-registers the import", async () => {
    const h = createTestHarness();
    const noteId = await createPersonalNote(h);
    const jobs = recordingJobs();
    // The body as `importExternalReferences` left it: storage URLs and an
    // inlined stylesheet. Importing creates no revision, so the newest
    // revision is the body from *before* that.
    const version = await saveBody(
      h,
      noteId,
      '<p><img src="/storage/imported.png"></p><style data-imported-stylesheet="https://cdn.example.test/s.css">p{color:red;}</style>',
      0,
    );
    seedRevision(h, noteId, {
      id: "revision-pre-import",
      html: '<p><img src="https://cdn.example.test/a.png"></p><style data-stylesheet-href="https://cdn.example.test/s.css"></style>',
      createdAt: AT,
    });

    await restore(h, noteId, "revision-pre-import", version, { jobs });

    const html = readyBody(storedNote(h, noteId));
    expect(html).toContain('src="https://cdn.example.test/a.png"');
    expect(html).toContain(
      'data-stylesheet-href="https://cdn.example.test/s.css"',
    );
    expect(html).not.toContain("data-imported-stylesheet");
    expect(jobs.requests).toHaveLength(1);
    expect(jobs.requests[0]?.noteId).toBe(noteId);
  });

  it("TC-note-483: a restored body with no external reference registers no import job", async () => {
    const h = createTestHarness();
    const noteId = await createPersonalNote(h);
    const jobs = recordingJobs();
    const version = await saveBody(h, noteId, "<p>current</p>", 0);
    seedRevision(h, noteId, {
      id: "revision-plain",
      html: '<p><img src="/storage/local.png"></p>',
      createdAt: AT,
    });

    await restore(h, noteId, "revision-plain", version, { jobs });

    expect(jobs.requests).toHaveLength(0);
  });

  it("TC-note-484: an unterminated referenceImport job blocks a second registration", async () => {
    const h = createTestHarness();
    const noteId = await createPersonalNote(h);
    const jobs = recordingJobs([
      { jobId: "job-existing", kind: "referenceImport" },
    ]);
    const version = await saveBody(h, noteId, "<p>current</p>", 0);
    seedRevision(h, noteId, {
      id: "revision-external",
      html: '<p><img src="https://cdn.example.test/a.png"></p>',
      createdAt: AT,
    });

    await restore(h, noteId, "revision-external", version, { jobs });

    expect(jobs.requests).toHaveLength(0);
    expect(readyBody(storedNote(h, noteId))).toContain("cdn.example.test");
  });

  it("TC-note-475: the unlisted status and its share link survive a restore", async () => {
    const h = createTestHarness();
    const noteId = await createPersonalNote(h);
    const saved = await saveBody(h, noteId, "<p>current</p>", 0);
    const shareLink = ShareLink.create({
      tokenHash: TokenHash.create("a".repeat(64)),
      protectedToken: { cipherText: "cipher", keyVersion: 1 },
      password: null,
      issuedAt: h.clock.now(),
    });
    await h.container.scopeUnitOfWorkProvider.run(userScope, async (ctx) => {
      const stored = await ctx.noteRepository.findById(NoteId.create(noteId));
      if (stored === null || !Note.isActive(stored.entity)) {
        throw new Error("seed failed");
      }
      await ctx.noteRepository.save(
        Note.makeUnlisted(stored.entity, shareLink, h.clock.now()).entity,
        stored.expectedVersion,
      );
    });
    seedRevision(h, noteId, {
      id: "revision-old",
      html: "<p>older body</p>",
      createdAt: AT,
    });

    await restore(h, noteId, "revision-old", saved + 1);

    const visibility = storedNote(h, noteId)?.visibility;
    expect(visibility?.status).toBe("unlisted");
    if (visibility?.status !== "unlisted") {
      throw new Error("expected an unlisted note");
    }
    expect(visibility.shareLink).toEqual(shareLink);
  });

  it("TC-note-477: a stale expectedVersion is refused with OPTIMISTIC_LOCK_FAILURE", async () => {
    const h = createTestHarness();
    const noteId = await createPersonalNote(h);
    const version = await saveBody(h, noteId, "<p>current</p>", 0);
    seedRevision(h, noteId, {
      id: "revision-old",
      html: "<p>older body</p>",
      createdAt: AT,
    });

    await expect(
      restore(h, noteId, "revision-old", version - 1),
    ).rejects.toSatisfy(
      (error) =>
        isConflictError(error) && error.code === "OPTIMISTIC_LOCK_FAILURE",
    );
    expect(readyBody(storedNote(h, noteId))).toBe("<p>current</p>");
  });

  it("TC-note-474: a workspace viewer is answered NOTE_NOT_FOUND", async () => {
    const h = createTestHarness();
    await seedWorkspace(h, [
      { userId: OWNER, role: "owner" },
      { userId: VIEWER, role: "viewer" },
    ]);
    const noteId = await createWorkspaceNote(h);
    seedRevision(
      h,
      noteId,
      { id: "revision-old", html: "<p>older</p>", createdAt: AT },
      workspaceScope,
    );

    await expect(
      restore(h, noteId, "revision-old", 0, { userId: VIEWER }),
    ).rejects.toSatisfy(isNotFoundError);
    expect(storedNote(h, noteId, workspaceScope)?.version).toBe(0);
  });

  it("TC-note-470: the restore emits the content, style and title events together", async () => {
    const h = createTestHarness();
    const noteId = await createPersonalNote(h);
    const version = await saveBody(h, noteId, "<p>current</p>", 0);
    seedRevision(h, noteId, {
      id: "revision-old",
      html: "<p>older body</p>",
      createdAt: AT,
      title: "元のタイトル",
      styleMode: "preserve",
    });
    const contentEventsBefore = eventsOfType(h, "note.contentUpdated").length;

    await restore(h, noteId, "revision-old", version);

    expect(eventsOfType(h, "note.contentUpdated")).toHaveLength(
      contentEventsBefore + 1,
    );
    expect(eventsOfType(h, "note.styleModeChanged")).toHaveLength(1);
    expect(eventsOfType(h, "note.renamed")).toHaveLength(1);
  });
});
