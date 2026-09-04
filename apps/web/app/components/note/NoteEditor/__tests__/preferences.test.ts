import { describe, expect, it } from "vitest";
import {
  DRAFT_MAX_AGE_MS,
  isExpired,
  type LocalDraft,
  parseDraft,
} from "../preferences";

const DRAFT: LocalDraft = { html: "<p>x</p>", title: "t", savedAt: 1_000 };

describe("parseDraft", () => {
  it("reads back what writeDraft stored", () => {
    expect(parseDraft(JSON.stringify(DRAFT))).toEqual(DRAFT);
  });

  it("drops the extra keys a future version might add", () => {
    expect(parseDraft(JSON.stringify({ ...DRAFT, mode: "html" }))).toEqual(
      DRAFT,
    );
  });

  it.each([
    ["no value at all", null],
    ["a value that is not JSON", "{"],
    ["a JSON scalar", '"draft"'],
    ["JSON null", "null"],
    ["an array", "[]"],
    ["a missing body", JSON.stringify({ title: "t", savedAt: 1 })],
    ["a missing title", JSON.stringify({ html: "x", savedAt: 1 })],
    ["a missing timestamp", JSON.stringify({ html: "x", title: "t" })],
    [
      "a timestamp of the wrong type",
      JSON.stringify({ html: "x", title: "t", savedAt: "1" }),
    ],
  ])("refuses %s", (_label, raw) => {
    expect(parseDraft(raw)).toBeNull();
  });
});

describe("isExpired", () => {
  it("keeps a draft saved exactly the retention span ago", () => {
    expect(isExpired(DRAFT, DRAFT.savedAt + DRAFT_MAX_AGE_MS)).toBe(false);
  });

  it("drops a draft one millisecond past the retention span", () => {
    expect(isExpired(DRAFT, DRAFT.savedAt + DRAFT_MAX_AGE_MS + 1)).toBe(true);
  });

  it("keeps a draft saved just now", () => {
    expect(isExpired(DRAFT, DRAFT.savedAt)).toBe(false);
  });

  it("keeps a draft whose timestamp is in the future", () => {
    // 端末の時計が進んでいるだけで、書きかけを捨ててよい理由にはならない。
    expect(isExpired(DRAFT, DRAFT.savedAt - DRAFT_MAX_AGE_MS)).toBe(false);
  });
});
