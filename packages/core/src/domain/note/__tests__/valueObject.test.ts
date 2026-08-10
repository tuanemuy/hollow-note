import { isBusinessRuleError } from "@repo/core/domain/error";
import { UserId } from "@repo/core/domain/identity/valueObject";
import { WorkspaceId } from "@repo/core/domain/workspace/valueObject";
import { describe, expect, it } from "vitest";
import { NoteErrorCode } from "../errorCode";
import {
  Excerpt,
  NoteHeading,
  NoteHtml,
  NoteOwner,
  NoteTitle,
  StyleMode,
} from "../valueObject";

/** A UTF-8 round trip is lossless exactly when no lone surrogate remains. */
const isWellFormed = (value: string): boolean =>
  new TextDecoder().decode(new TextEncoder().encode(value)) === value;

const codeOf = (fn: () => unknown): string | null => {
  try {
    fn();
    return null;
  } catch (error) {
    return isBusinessRuleError(error) ? error.code : null;
  }
};

describe("NoteTitle", () => {
  it("replaces an empty / whitespace-only title with 無題 without throwing", () => {
    expect(NoteTitle.manual("").value).toBe("無題");
    expect(NoteTitle.auto("   ").value).toBe("無題");
  });

  it("accepts exactly 200 characters", () => {
    const value = "あ".repeat(200);
    expect(NoteTitle.manual(value).value).toBe(value);
  });

  it("rejects 201 characters with InvalidTitle", () => {
    expect(codeOf(() => NoteTitle.manual("あ".repeat(201)))).toBe(
      NoteErrorCode.InvalidTitle,
    );
  });

  it("keeps the origin and excludes it from equality", () => {
    const auto = NoteTitle.auto("Report");
    const manual = NoteTitle.manual("Report");
    expect(NoteTitle.isAuto(auto)).toBe(true);
    expect(NoteTitle.isAuto(manual)).toBe(false);
    expect(NoteTitle.equals(auto, manual)).toBe(true);
  });
});

describe("NoteHtml", () => {
  it("accepts exactly 800,000 UTF-8 bytes", () => {
    expect(() => NoteHtml.create("a".repeat(800_000))).not.toThrow();
  });

  it("rejects 800,001 UTF-8 bytes", () => {
    expect(codeOf(() => NoteHtml.create("a".repeat(800_001)))).toBe(
      NoteErrorCode.ContentTooLarge,
    );
  });

  it("counts bytes, not characters, for multibyte input", () => {
    // 3 bytes per character: 266,667 chars = 800,001 bytes.
    expect(() => NoteHtml.create("あ".repeat(266_666))).not.toThrow();
    expect(codeOf(() => NoteHtml.create("あ".repeat(266_667)))).toBe(
      NoteErrorCode.ContentTooLarge,
    );
  });

  it("empty() builds the empty body", () => {
    expect(NoteHtml.empty()).toBe("");
  });
});

describe("Excerpt", () => {
  it("fromText cuts at 200 characters", () => {
    expect(Excerpt.fromText("a".repeat(300))).toHaveLength(200);
  });

  it("create rejects over 200 characters", () => {
    expect(codeOf(() => Excerpt.create("a".repeat(201)))).toBe(
      NoteErrorCode.ContentTooLarge,
    );
  });

  it("fromText never cuts a non-BMP character in half", () => {
    // The emoji straddles the boundary: units 199/200 of a 201-unit string.
    const excerpt = Excerpt.fromText(`${"a".repeat(199)}😀`);
    expect(excerpt).toHaveLength(199);
    expect(isWellFormed(excerpt)).toBe(true);
    expect(() => Excerpt.create(excerpt)).not.toThrow();
  });

  it("fromText keeps a non-BMP character that ends exactly on the boundary", () => {
    const excerpt = Excerpt.fromText(`${"a".repeat(198)}😀${"b".repeat(10)}`);
    expect(excerpt).toHaveLength(200);
    expect(excerpt.endsWith("😀")).toBe(true);
    expect(isWellFormed(excerpt)).toBe(true);
  });
});

describe("NoteHeading", () => {
  it("truncates text past 100 characters", () => {
    const heading = NoteHeading.create({
      level: 2,
      text: "x".repeat(150),
      anchorId: "h-1",
    });
    expect(heading.text).toHaveLength(100);
  });

  it("never cuts a non-BMP character in half when truncating", () => {
    const heading = NoteHeading.create({
      level: 2,
      text: `${"x".repeat(99)}😀`,
      anchorId: "h-1",
    });
    expect(heading.text).toHaveLength(99);
    expect(isWellFormed(heading.text)).toBe(true);
  });

  it("rejects level out of 1-6 and an empty anchor", () => {
    expect(() =>
      NoteHeading.create({ level: 0, text: "t", anchorId: "a" }),
    ).toThrowError();
    expect(() =>
      NoteHeading.create({ level: 7, text: "t", anchorId: "a" }),
    ).toThrowError();
    expect(() =>
      NoteHeading.create({ level: 1, text: "t", anchorId: "" }),
    ).toThrowError();
  });
});

describe("StyleMode", () => {
  it("accepts only default / preserve", () => {
    expect(StyleMode.create("default")).toBe("default");
    expect(StyleMode.create("preserve")).toBe("preserve");
    expect(codeOf(() => StyleMode.create("plain"))).toBe(
      NoteErrorCode.InvalidStyleMode,
    );
  });
});

describe("NoteOwner", () => {
  it("compares by type and id", () => {
    const u1 = NoteOwner.user(UserId.create("u1"));
    const u1b = NoteOwner.user(UserId.create("u1"));
    const u2 = NoteOwner.user(UserId.create("u2"));
    const w1 = NoteOwner.workspace(WorkspaceId.create("u1"));
    expect(NoteOwner.equals(u1, u1b)).toBe(true);
    expect(NoteOwner.equals(u1, u2)).toBe(false);
    expect(NoteOwner.equals(u1, w1)).toBe(false);
  });
});
