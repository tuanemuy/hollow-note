import { afterEach, describe, expect, it } from "vitest";
import {
  DRAFT_MAX_AGE_MS,
  isExpired,
  type LocalDraft,
  parseDraft,
  writeDraft,
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

/**
 * 退避の成否。web の vitest は `environment: "node"` なので `window` は
 * この 2 ケースが自分で置く — 置くものが `setItem` の振る舞いそのもの
 * なので、実ブラウザでも同じ 2 分岐しかない。
 */
describe("writeDraft", () => {
  const original = Reflect.get(globalThis, "window") as unknown;

  afterEach(() => {
    if (original === undefined) {
      Reflect.deleteProperty(globalThis, "window");
      return;
    }
    Reflect.set(globalThis, "window", original);
  });

  const stubStorage = (setItem: (key: string, value: string) => void): void => {
    Reflect.set(globalThis, "window", { localStorage: { setItem } });
  };

  it("reports the draft as stashed when the device stores it", () => {
    const stored = new Map<string, string>();
    stubStorage((key, value) => {
      stored.set(key, value);
    });
    expect(writeDraft("note-1", DRAFT)).toBe(true);
    expect(
      parseDraft(stored.get("hollow.noteEditor.draft.note-1") ?? null),
    ).toEqual(DRAFT);
  });

  it("reports nothing stashed when the device refuses to store", () => {
    stubStorage(() => {
      throw new DOMException("QuotaExceededError");
    });
    expect(writeDraft("note-1", DRAFT)).toBe(false);
  });
});
