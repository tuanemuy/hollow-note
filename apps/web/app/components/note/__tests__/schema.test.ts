import { createHtmlProcessor } from "@repo/core/adapters/html/htmlProcessor";
import { isBusinessRuleError } from "@repo/core/domain/error";
import { NoteErrorCode } from "@repo/core/domain/note/errorCode";
import { describe, expect, it } from "vitest";
import { WORKSPACE_ID_MAX_LENGTH } from "@/presentation/scope";
import {
  createNoteWithBodySchema,
  moveNoteSchema,
  updateNoteBodySchema,
} from "../schema";

const accepts = (value: unknown): boolean =>
  moveNoteSchema.safeParse(value).success;

describe("moveNoteSchema", () => {
  it("takes the personal destination without a workspace id", () => {
    expect(accepts({ noteId: "note_1", targetOwnerType: "user" })).toBe(true);
  });

  it("takes the workspace destination with a workspace id", () => {
    expect(
      accepts({
        noteId: "note_1",
        targetOwnerType: "workspace",
        targetWorkspaceId: "ws_1",
      }),
    ).toBe(true);
  });

  it("rejects a workspace destination whose id is null or missing", () => {
    expect(
      accepts({
        noteId: "note_1",
        targetOwnerType: "workspace",
        targetWorkspaceId: null,
      }),
    ).toBe(false);
    expect(
      accepts({
        noteId: "note_1",
        targetOwnerType: "workspace",
        targetWorkspaceId: "",
      }),
    ).toBe(false);
    expect(accepts({ noteId: "note_1", targetOwnerType: "workspace" })).toBe(
      false,
    );
  });

  it("rejects an unknown destination and a missing note id", () => {
    expect(accepts({ noteId: "note_1", targetOwnerType: "everyone" })).toBe(
      false,
    );
    expect(accepts({ targetOwnerType: "user" })).toBe(false);
  });

  it("keeps the workspace id under the transport ceiling", () => {
    const target = (length: number) => ({
      noteId: "note_1",
      targetOwnerType: "workspace",
      targetWorkspaceId: "a".repeat(length),
    });
    expect(accepts(target(WORKSPACE_ID_MAX_LENGTH))).toBe(true);
    expect(accepts(target(WORKSPACE_ID_MAX_LENGTH + 1))).toBe(false);
  });
});

const NOTE_HTML_TRANSPORT_MAX = 2_000_000;

const updateWith = (rawHtml: string) => ({
  noteId: "note_1",
  rawHtml,
  expectedVersion: 0,
  reason: "manualEdit" as const,
  importReferences: false,
});

describe("the note body transport bound", () => {
  it("takes a raw body of exactly the ceiling and refuses one past it", () => {
    const at = "a".repeat(NOTE_HTML_TRANSPORT_MAX);
    expect(updateNoteBodySchema.safeParse(updateWith(at)).success).toBe(true);
    expect(updateNoteBodySchema.safeParse(updateWith(`${at}a`)).success).toBe(
      false,
    );
  });

  it("applies the same ceiling to the first save of a new note", () => {
    const withBody = (rawHtml: string) => ({
      workspaceId: null,
      title: "t",
      rawHtml,
      importReferences: false,
    });
    const at = "a".repeat(NOTE_HTML_TRANSPORT_MAX);
    expect(createNoteWithBodySchema.safeParse(withBody(at)).success).toBe(true);
    expect(createNoteWithBodySchema.safeParse(withBody(`${at}a`)).success).toBe(
      false,
    );
  });

  /**
   * The transport bound measures raw HTML and the domain's 800 KB measures
   * the sanitized body, so a save the domain has an opinion about has to
   * get past transport first. While the two numbers were equal, ED-03's
   * refusal came back as a transport shape violation instead.
   */
  it("lets an oversized body reach NOTE_CONTENT_TOO_LARGE, not INVALID_INPUT", () => {
    const rawHtml = `<script>${"s".repeat(400_000)}</script><p>${"あ".repeat(
      400_000,
    )}</p>`;
    expect(rawHtml.length).toBeGreaterThan(800_000);
    expect(rawHtml.length).toBeLessThanOrEqual(NOTE_HTML_TRANSPORT_MAX);
    expect(updateNoteBodySchema.safeParse(updateWith(rawHtml)).success).toBe(
      true,
    );

    const refusal = (() => {
      try {
        createHtmlProcessor().process(rawHtml);
        return undefined;
      } catch (cause) {
        return cause;
      }
    })();
    expect(isBusinessRuleError(refusal)).toBe(true);
    expect((refusal as { code: string }).code).toBe(
      NoteErrorCode.ContentTooLarge,
    );
  });
});
