import { describe, expect, it } from "vitest";
import { WORKSPACE_SLUG_MAX_LENGTH } from "../schema";
import { slugSuggestionsFor } from "../slugSuggestions";

const yearSuffix = `-${new Date().getFullYear() % 100}`;

describe("slugSuggestionsFor", () => {
  it("keeps every candidate within the slug ceiling", () => {
    for (const base of [
      "a",
      "team",
      "a".repeat(WORKSPACE_SLUG_MAX_LENGTH - 1),
      "a".repeat(WORKSPACE_SLUG_MAX_LENGTH),
      "a".repeat(WORKSPACE_SLUG_MAX_LENGTH + 40),
    ]) {
      const suggestions = slugSuggestionsFor(base);
      expect(suggestions).toHaveLength(3);
      for (const candidate of suggestions) {
        expect([
          candidate,
          candidate.length <= WORKSPACE_SLUG_MAX_LENGTH,
        ]).toStrictEqual([candidate, true]);
      }
    }
  });

  it("cuts the base so a full-length slug still gets its suffix", () => {
    const base = "a".repeat(WORKSPACE_SLUG_MAX_LENGTH);
    expect(slugSuggestionsFor(base)).toStrictEqual([
      `${"a".repeat(WORKSPACE_SLUG_MAX_LENGTH - 2)}-2`,
      `${"a".repeat(WORKSPACE_SLUG_MAX_LENGTH - 5)}-team`,
      `${"a".repeat(WORKSPACE_SLUG_MAX_LENGTH - yearSuffix.length)}${yearSuffix}`,
    ]);
  });

  it("normalizes the base and keeps a short one whole", () => {
    expect(slugSuggestionsFor("  Team  ")).toStrictEqual([
      "team-2",
      "team-team",
      `team${yearSuffix}`,
    ]);
  });

  it("has nothing to suggest for an empty base", () => {
    expect(slugSuggestionsFor("")).toStrictEqual([]);
    expect(slugSuggestionsFor("   ")).toStrictEqual([]);
  });
});
