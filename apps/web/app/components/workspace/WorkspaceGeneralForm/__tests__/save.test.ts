import { describe, expect, it } from "vitest";
import { AppServerError } from "@/presentation/errorResponse";
import { saveErrorFor, saveOutcome } from "../save";

const slugTaken = () =>
  new AppServerError({
    kind: "conflict",
    code: "SLUG_ALREADY_USED",
    message: "Workspace slug design is taken",
  });

describe("saveOutcome", () => {
  it("invalidates the loader after a partial success that ended in an error", () => {
    const outcome = saveOutcome(true, { slug: "design", error: slugTaken() });

    expect(outcome.reconcile).toBe(true);
    expect(outcome.state.kind).toBe("error");
  });

  it("leaves the loader alone when nothing was written", () => {
    const outcome = saveOutcome(false, { slug: "design", error: slugTaken() });

    expect(outcome.reconcile).toBe(false);
    expect(outcome.state.kind).toBe("error");
  });

  it("invalidates the loader once every step landed", () => {
    expect(saveOutcome(true, null)).toEqual({
      reconcile: true,
      state: { kind: "saved" },
    });
  });
});

describe("saveErrorFor", () => {
  it("puts a taken slug on the slug field with alternatives", () => {
    const error = saveErrorFor("design", slugTaken());

    expect(error.target).toBe("slug");
    expect(error.slug).toBe("design");
    expect(error.suggestions.length).toBeGreaterThan(0);
  });

  it("falls back to the form for an error that belongs to no field", () => {
    const error = saveErrorFor(
      "design",
      new AppServerError({
        kind: "forbidden",
        code: "WORKSPACE_INSUFFICIENT_ROLE",
        message: "owner only",
      }),
    );

    expect(error.target).toBe("form");
    expect(error.suggestions).toEqual([]);
  });
});
