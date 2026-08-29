import { isBusinessRuleError, RehydrationError } from "@repo/core/domain/error";
import {
  PasswordHash,
  TokenHash,
  UserId,
} from "@repo/core/domain/identity/valueObject";
import { StoredFileId } from "@repo/core/domain/storage/valueObject";
import { describe, expect, it } from "vitest";
import { NoteErrorCode } from "../errorCode";
import { Note } from "../note";
import { NoteRevision } from "../noteRevision";
import type { ProcessedHtml } from "../ports/htmlProcessor";
import {
  Excerpt,
  MAX_HEADINGS_PER_NOTE,
  NoteHeading,
  NoteHtml,
  NoteOwner,
  NoteTitle,
  PlainTextContent,
  ShareLink,
} from "../valueObject";

const T0 = new Date(0);
const at = (ms: number) => new Date(ms);
const DAY = 24 * 60 * 60 * 1000;

const creator = UserId.create("u1");
const owner = NoteOwner.user(creator);

const makeLink = (token: string, passwordHash: string | null = null) =>
  ShareLink.create({
    tokenHash: TokenHash.create(token),
    protectedToken: { cipherText: `enc(${token})`, keyVersion: 1 },
    password:
      passwordHash === null
        ? null
        : { hash: PasswordHash.create(passwordHash), updatedAt: T0 },
    issuedAt: T0,
  });

const blank = (nowMs = 0) =>
  Note.createBlank(
    { id: "n1", owner, createdBy: creator, title: "", projectionRevision: 1 },
    at(nowMs),
  ).entity;

const processingNote = () =>
  Note.createFromUpload(
    {
      id: "n2",
      owner,
      createdBy: creator,
      title: "report.pdf",
      sourceFileId: StoredFileId.create("f1"),
      initialContent: { status: "processing" },
      styleMode: "preserve",
      projectionRevision: 1,
    },
    T0,
  ).entity;

const codeOf = (fn: () => unknown): string | null => {
  try {
    fn();
    return null;
  } catch (error) {
    return isBusinessRuleError(error) ? error.code : null;
  }
};

describe("Note.createBlank", () => {
  it("creates a private, active note with an empty ready body and default style", () => {
    const { entity, eventDrafts } = Note.createBlank(
      { id: "n1", owner, createdBy: creator, title: "", projectionRevision: 7 },
      T0,
    );
    expect(entity.lifecycle).toBe("active");
    expect(entity.title.value).toBe("無題");
    expect(entity.content).toMatchObject({ status: "ready", html: "" });
    if (entity.content.status === "ready") {
      expect(entity.content.text).toBe("");
      expect(entity.content.headings).toEqual([]);
    }
    expect(entity.visibility).toEqual({
      status: "private",
      dormantShareLink: null,
    });
    expect(entity.styleMode).toBe("default");
    expect(entity.sourceFileId).toBeNull();
    expect(entity.version).toBe(0);
    expect(eventDrafts).toHaveLength(1);
    expect(eventDrafts[0]?.type).toBe("note.created");
    expect(eventDrafts[0]?.payload).toMatchObject({
      noteId: "n1",
      createdBy: "u1",
      sourceFileId: null,
      projectionRevision: 7,
    });
  });

  it("keeps a provided title", () => {
    const { entity } = Note.createBlank(
      {
        id: "n1",
        owner,
        createdBy: creator,
        title: " My note ",
        projectionRevision: 1,
      },
      T0,
    );
    expect(entity.title.value).toBe("My note");
  });
});

describe("Note.createFromUpload", () => {
  it("takes the initial content state as-is and names the title auto", () => {
    const note = processingNote();
    expect(note.content.status).toBe("processing");
    expect(note.title.origin).toBe("auto");
    expect(note.sourceFileId).toBe("f1");
    expect(note.visibility.status).toBe("private");
  });
});

const titledNote = (title: string) =>
  Note.createBlank(
    { id: "n1", owner, createdBy: creator, title, projectionRevision: 1 },
    T0,
  ).entity;

const conversionResult = (
  title: NoteTitle | null,
  headingCount = 1,
): Parameters<typeof Note.applyConversionResult>[1] => ({
  html: NoteHtml.create("<p>converted</p>"),
  text: PlainTextContent.create("converted"),
  excerpt: Excerpt.fromText("converted"),
  headings: Array.from({ length: headingCount }, (_, i) =>
    NoteHeading.create({ level: 2, text: `H${i}`, anchorId: `h-${i}` }),
  ),
  styleMode: "preserve",
  title,
});

const processedHtml = (headingCount = 2): ProcessedHtml => ({
  html: NoteHtml.create("<h2>Edited</h2><p>body</p>"),
  text: PlainTextContent.create("Edited body"),
  excerpt: Excerpt.fromText("Edited body"),
  hasDecoration: false,
  headings: Array.from({ length: headingCount }, (_, i) => ({
    level: 2,
    text: `H${i}`,
    anchorId: `h-${i}`,
  })),
  removed: [],
});

describe("Note.applyConversionResult", () => {
  it("replaces an auto title and emits note.renamed alongside note.contentUpdated", () => {
    const note = blank();
    expect(note.title.origin).toBe("auto");
    const { entity, eventDrafts } = Note.applyConversionResult(
      note,
      conversionResult(NoteTitle.auto("Converted")),
      at(5),
    );
    expect(entity.title).toEqual({ value: "Converted", origin: "auto" });
    expect(entity.content).toMatchObject({
      status: "ready",
      html: "<p>converted</p>",
      text: "converted",
      excerpt: "converted",
    });
    expect(entity.styleMode).toBe("preserve");
    expect(entity.version).toBe(note.version + 1);
    expect(entity.updatedAt).toEqual(at(5));
    expect(eventDrafts.map((d) => d.type)).toEqual([
      "note.contentUpdated",
      "note.renamed",
    ]);
    expect(eventDrafts[1]?.payload).toMatchObject({
      noteId: "n1",
      title: { value: "Converted", origin: "auto" },
    });
  });

  it("keeps a manual title and emits note.contentUpdated only", () => {
    const note = titledNote("My note");
    expect(note.title.origin).toBe("manual");
    const { entity, eventDrafts } = Note.applyConversionResult(
      note,
      conversionResult(NoteTitle.auto("Converted")),
      at(5),
    );
    expect(entity.title).toEqual({ value: "My note", origin: "manual" });
    expect(eventDrafts.map((d) => d.type)).toEqual(["note.contentUpdated"]);
  });

  it("keeps the current title when the result carries none", () => {
    const { entity, eventDrafts } = Note.applyConversionResult(
      blank(),
      conversionResult(null),
      at(5),
    );
    expect(entity.title.value).toBe("無題");
    expect(eventDrafts.map((d) => d.type)).toEqual(["note.contentUpdated"]);
  });

  it("caps the headings at 200, dropping the 201st", () => {
    const { entity } = Note.applyConversionResult(
      blank(),
      conversionResult(null, MAX_HEADINGS_PER_NOTE + 1),
      at(5),
    );
    if (entity.content.status !== "ready") {
      throw new Error("expected a ready body");
    }
    expect(entity.content.headings).toHaveLength(MAX_HEADINGS_PER_NOTE);
    expect(entity.content.headings.at(-1)?.anchorId).toBe(
      `h-${MAX_HEADINGS_PER_NOTE - 1}`,
    );
  });
});

describe("Note.updateBody", () => {
  it("builds a ready body from the processed HTML and emits note.contentUpdated", () => {
    const note = processingNote();
    const { entity, eventDrafts } = Note.updateBody(
      note,
      processedHtml(),
      at(7),
    );
    expect(entity.content).toEqual({
      status: "ready",
      html: "<h2>Edited</h2><p>body</p>",
      text: "Edited body",
      excerpt: "Edited body",
      headings: [
        { level: 2, text: "H0", anchorId: "h-0" },
        { level: 2, text: "H1", anchorId: "h-1" },
      ],
    });
    expect(entity.version).toBe(note.version + 1);
    expect(entity.updatedAt).toEqual(at(7));
    expect(eventDrafts.map((d) => d.type)).toEqual(["note.contentUpdated"]);
  });

  it("caps the headings at 200, dropping the 201st", () => {
    const { entity } = Note.updateBody(
      blank(),
      processedHtml(MAX_HEADINGS_PER_NOTE + 1),
      at(7),
    );
    if (entity.content.status !== "ready") {
      throw new Error("expected a ready body");
    }
    expect(entity.content.headings).toHaveLength(MAX_HEADINGS_PER_NOTE);
  });
});

describe("Note.rename / changeStyleMode", () => {
  it("rename normalizes through NoteTitle and emits note.renamed", () => {
    const { entity, eventDrafts } = Note.rename(blank(), "  ", at(1));
    expect(entity.title.value).toBe("無題");
    expect(entity.title.origin).toBe("manual");
    expect(eventDrafts[0]?.type).toBe("note.renamed");
  });

  it("changeStyleMode validates the mode", () => {
    const { entity, eventDrafts } = Note.changeStyleMode(
      blank(),
      "preserve",
      at(1),
    );
    expect(entity.styleMode).toBe("preserve");
    expect(eventDrafts[0]?.type).toBe("note.styleModeChanged");
    expect(codeOf(() => Note.changeStyleMode(blank(), "shiny", at(1)))).toBe(
      NoteErrorCode.InvalidStyleMode,
    );
  });
});

describe("Note visibility transitions", () => {
  it("makeUnlisted requires a ready body", () => {
    expect(
      codeOf(() => Note.makeUnlisted(processingNote(), makeLink("t1"), T0)),
    ).toBe(NoteErrorCode.CannotPublishEmptyNote);
    expect(codeOf(() => Note.makePublic(processingNote(), T0))).toBe(
      NoteErrorCode.CannotPublishEmptyNote,
    );
  });

  it("makeUnlisted uses the new link when no dormant link exists, and requires one", () => {
    const link = makeLink("t1");
    const { entity, eventDrafts } = Note.makeUnlisted(blank(), link, at(1));
    expect(entity.visibility).toEqual({ status: "unlisted", shareLink: link });
    expect(eventDrafts[0]?.type).toBe("note.visibilityChanged");
    expect(eventDrafts[0]?.payload).toMatchObject({
      previous: "private",
      current: "unlisted",
    });
    expect(codeOf(() => Note.makeUnlisted(blank(), null, at(1)))).toBe(
      NoteErrorCode.ShareLinkRequired,
    );
  });

  it("returning to unlisted revives the dormant link instead of the new one", () => {
    const original = makeLink("t1", "pw");
    const unlisted = Note.makeUnlisted(blank(), original, at(1)).entity;
    const hidden = Note.makePrivate(unlisted, at(2)).entity;
    expect(hidden.visibility).toMatchObject({
      status: "private",
      dormantShareLink: original,
    });
    const revived = Note.makeUnlisted(hidden, makeLink("t2"), at(3)).entity;
    expect(revived.visibility).toEqual({
      status: "unlisted",
      shareLink: original,
    });
  });

  it("makePublic strips the share password and emits visibilityChanged + published", () => {
    const unlisted = Note.makeUnlisted(
      blank(),
      makeLink("t1", "pw"),
      at(1),
    ).entity;
    const { entity, eventDrafts } = Note.makePublic(unlisted, at(2));
    expect(entity.visibility.status).toBe("public");
    if (entity.visibility.status === "public") {
      expect(entity.visibility.publishedAt).toEqual(at(2));
      expect(entity.visibility.dormantShareLink?.password).toBeNull();
    }
    expect(eventDrafts.map((d) => d.type)).toEqual([
      "note.visibilityChanged",
      "note.published",
    ]);
  });
});

describe("Note.reissueShareLink / setSharePassword", () => {
  it("reissue keeps the existing password while swapping the token", () => {
    const unlisted = Note.makeUnlisted(
      blank(),
      makeLink("t1", "pw"),
      at(1),
    ).entity;
    const { entity, eventDrafts } = Note.reissueShareLink(
      unlisted,
      makeLink("t2"),
      at(2),
    );
    expect(entity.visibility.status).toBe("unlisted");
    if (entity.visibility.status === "unlisted") {
      expect(entity.visibility.shareLink.tokenHash).toBe("t2");
      expect(entity.visibility.shareLink.password?.hash).toBe("pw");
    }
    expect(eventDrafts[0]?.type).toBe("note.shareLinkReissued");
  });

  it("both refuse non-unlisted notes with NotUnlisted", () => {
    expect(
      codeOf(() => Note.reissueShareLink(blank(), makeLink("t2"), at(1))),
    ).toBe(NoteErrorCode.NotUnlisted);
    expect(
      codeOf(() =>
        Note.setSharePassword(blank(), PasswordHash.create("pw"), at(1)),
      ),
    ).toBe(NoteErrorCode.NotUnlisted);
  });

  it("setSharePassword stamps updatedAt=now and null clears the password", () => {
    const unlisted = Note.makeUnlisted(blank(), makeLink("t1"), at(1)).entity;
    const protectedNote = Note.setSharePassword(
      unlisted,
      PasswordHash.create("pw"),
      at(2),
    ).entity;
    if (protectedNote.visibility.status === "unlisted") {
      expect(protectedNote.visibility.shareLink.password).toEqual({
        hash: "pw",
        updatedAt: at(2),
      });
    }
    const cleared = Note.setSharePassword(protectedNote, null, at(3)).entity;
    if (cleared.visibility.status === "unlisted") {
      expect(cleared.visibility.shareLink.password).toBeNull();
    }
  });
});

describe("Note.trash / restore", () => {
  it("trash stamps trashedAt and purgeAfter = trashedAt + 30 days", () => {
    const { entity, eventDrafts } = Note.trash(blank(), at(1000));
    expect(entity.lifecycle).toBe("trashed");
    expect(entity.trashedAt).toEqual(at(1000));
    expect(entity.purgeAfter).toEqual(at(1000 + 30 * DAY));
    expect(eventDrafts[0]?.type).toBe("note.trashed");
  });

  it("restore returns to active, preserving visibility and style", () => {
    const unlisted = Note.makeUnlisted(blank(), makeLink("t1"), at(1)).entity;
    const trashed = Note.trash(unlisted, at(2)).entity;
    const { entity, eventDrafts } = Note.restore(trashed, at(3));
    expect(entity.lifecycle).toBe("active");
    expect(entity.visibility.status).toBe("unlisted");
    expect("trashedAt" in entity).toBe(false);
    expect(eventDrafts[0]?.type).toBe("note.restored");
  });
});

describe("Note.withOwner", () => {
  it("is a no-op for the same owner", () => {
    const note = blank();
    expect(Note.withOwner(note, owner, at(1))).toBe(note);
  });

  it("re-owns the note and bumps its version on a real move", () => {
    const other = NoteOwner.user(UserId.create("u2"));
    const note = blank();
    const moved = Note.withOwner(note, other, at(1));
    expect(moved.owner).toEqual(other);
    expect(moved.version).toBe(note.version + 1);
    expect(moved.updatedAt).toEqual(at(1));
  });
});

describe("Note.markConversionFailed / markAwaitingIntegration", () => {
  it("records the failure reason", () => {
    const { entity, eventDrafts } = Note.markConversionFailed(
      processingNote(),
      "canceled",
      at(1),
    );
    expect(entity.content).toEqual({ status: "failed", reason: "canceled" });
    expect(eventDrafts[0]?.type).toBe("note.conversionFailed");
  });

  it("moves to awaitingIntegration", () => {
    const { entity, eventDrafts } = Note.markAwaitingIntegration(
      processingNote(),
      at(1),
    );
    expect(entity.content).toEqual({ status: "awaitingIntegration" });
    expect(eventDrafts[0]?.type).toBe("note.awaitingIntegration");
  });

  it("both refuse to demote the body of a shared note", () => {
    const unlisted = Note.makeUnlisted(blank(), makeLink("t1"), at(1)).entity;
    const published = Note.makePublic(unlisted, at(2)).entity;

    expect(
      codeOf(() => Note.markConversionFailed(unlisted, "timeout", at(3))),
    ).toBe(NoteErrorCode.CannotPublishEmptyNote);
    expect(codeOf(() => Note.markAwaitingIntegration(unlisted, at(3)))).toBe(
      NoteErrorCode.CannotPublishEmptyNote,
    );
    expect(
      codeOf(() => Note.markConversionFailed(published, "timeout", at(3))),
    ).toBe(NoteErrorCode.CannotPublishEmptyNote);
    expect(codeOf(() => Note.markAwaitingIntegration(published, at(3)))).toBe(
      NoteErrorCode.CannotPublishEmptyNote,
    );
  });
});

describe("NoteRevision.capture", () => {
  it("captures a ready body", () => {
    const revision = NoteRevision.capture(
      { id: "r1", note: blank(), createdBy: creator, reason: "manualEdit" },
      at(1),
    );
    expect(revision.noteId).toBe("n1");
    expect(revision.reason).toBe("manualEdit");
  });

  it("rejects a non-ready body with CannotCaptureEmptyContent", () => {
    expect(
      codeOf(() =>
        NoteRevision.capture(
          {
            id: "r1",
            note: processingNote(),
            createdBy: creator,
            reason: "manualEdit",
          },
          at(1),
        ),
      ),
    ).toBe(NoteErrorCode.CannotCaptureEmptyContent);
  });
});

describe("Note.reconstruct", () => {
  it("round-trips a trashed unlisted note", () => {
    const note = Note.reconstruct({
      id: "n1",
      ownerType: "user",
      ownerId: "u1",
      createdBy: "u1",
      title: "T",
      titleOrigin: "manual",
      contentStatus: "ready",
      html: "<p>x</p>",
      text: "x",
      excerpt: "x",
      headings: [{ level: 1, text: "x", anchorId: "a" }],
      visibilityStatus: "unlisted",
      shareLink: {
        tokenHash: "t1",
        cipherText: "c",
        keyVersion: 1,
        passwordHash: "pw",
        passwordUpdatedAt: T0,
        issuedAt: T0,
      },
      styleMode: "default",
      lifecycle: "trashed",
      trashedAt: at(1),
      purgeAfter: at(1 + 30 * DAY),
      version: 4,
      createdAt: T0,
      updatedAt: at(1),
    });
    expect(note.lifecycle).toBe("trashed");
    expect(note.visibility.status).toBe("unlisted");
  });

  it("rejects a public note carrying a password-bearing dormant link with RehydrationError", () => {
    expect(() =>
      Note.reconstruct({
        id: "n1",
        ownerType: "user",
        ownerId: "u1",
        createdBy: "u1",
        title: "T",
        titleOrigin: "manual",
        contentStatus: "ready",
        html: "",
        text: "",
        excerpt: "",
        visibilityStatus: "public",
        publishedAt: T0,
        dormantShareLink: {
          tokenHash: "t1",
          cipherText: "c",
          keyVersion: 1,
          passwordHash: "pw",
          passwordUpdatedAt: T0,
          issuedAt: T0,
        },
        styleMode: "default",
        lifecycle: "active",
        version: 1,
        createdAt: T0,
        updatedAt: T0,
      }),
    ).toThrowError(RehydrationError);
  });

  it("accepts a public note whose dormant link carries no password", () => {
    const note = Note.reconstruct({
      id: "n1",
      ownerType: "user",
      ownerId: "u1",
      createdBy: "u1",
      title: "T",
      titleOrigin: "manual",
      contentStatus: "ready",
      html: "",
      text: "",
      excerpt: "",
      visibilityStatus: "public",
      publishedAt: T0,
      dormantShareLink: {
        tokenHash: "t1",
        cipherText: "c",
        keyVersion: 1,
        passwordHash: null,
        passwordUpdatedAt: null,
        issuedAt: T0,
      },
      styleMode: "default",
      lifecycle: "active",
      version: 1,
      createdAt: T0,
      updatedAt: T0,
    });
    expect(note.visibility).toMatchObject({
      status: "public",
      dormantShareLink: { tokenHash: "t1", password: null },
    });
  });

  describe("a ready body with a missing column", () => {
    const readyRow = (
      overrides: Record<string, unknown>,
    ): Parameters<typeof Note.reconstruct>[0] =>
      ({
        id: "n1",
        ownerType: "user",
        ownerId: "u1",
        createdBy: "u1",
        title: "T",
        titleOrigin: "manual",
        contentStatus: "ready",
        html: "<p>x</p>",
        text: "x",
        excerpt: "x",
        visibilityStatus: "private",
        styleMode: "default",
        lifecycle: "active",
        version: 1,
        createdAt: T0,
        updatedAt: T0,
        ...overrides,
      }) as Parameters<typeof Note.reconstruct>[0];

    it("accepts an empty body — a blank note is legal", () => {
      const note = Note.reconstruct(
        readyRow({ html: "", text: "", excerpt: "" }),
      );
      expect(note.content).toMatchObject({ status: "ready", html: "" });
    });

    for (const column of ["html", "text", "excerpt"] as const) {
      it(`rejects a missing ${column} instead of defaulting it to ""`, () => {
        expect(() =>
          Note.reconstruct(readyRow({ [column]: undefined })),
        ).toThrowError(RehydrationError);
        expect(() =>
          Note.reconstruct(readyRow({ [column]: null })),
        ).toThrowError(RehydrationError);
      });
    }

    it("still defaults missing headings to an empty list", () => {
      const note = Note.reconstruct(readyRow({ headings: undefined }));
      expect(note.content).toMatchObject({ status: "ready", headings: [] });
    });
  });
});
