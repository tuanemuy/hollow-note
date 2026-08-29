import { describe, expect, it } from "vitest";
import { WORKSPACE_ID_MAX_LENGTH } from "@/presentation/scope";
import { moveNoteSchema } from "../schema";

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
