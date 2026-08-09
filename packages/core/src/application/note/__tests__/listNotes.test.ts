import { describe, expect, it } from "vitest";
import { createTestHarness } from "../../__tests__/helpers";
import { createBlankNote } from "../createBlankNote";
import { listNotes } from "../listNotes";

// Walking-skeleton glue (ADR-005): a minimal internal read over
// NoteRepository.listByOwner, replaced by the canonical listing later.
describe("listNotes", () => {
  it("lists the viewer's active personal notes with a total count", async () => {
    const h = createTestHarness();
    await createBlankNote({
      container: h.container,
      input: {
        userId: "u1",
        ownerType: "user",
        ownerWorkspaceId: null,
        title: "One",
      },
    });
    await createBlankNote({
      container: h.container,
      input: {
        userId: "u1",
        ownerType: "user",
        ownerWorkspaceId: null,
        title: "Two",
      },
    });
    await createBlankNote({
      container: h.container,
      input: {
        userId: "u2",
        ownerType: "user",
        ownerWorkspaceId: null,
        title: "Foreign",
      },
    });

    const view = await listNotes({
      container: h.container,
      input: { userId: "u1" },
    });
    expect(view.count).toBe(2);
    expect(view.items.map((item) => item.title).sort()).toEqual(["One", "Two"]);
    expect(view.items[0]).toMatchObject({
      visibility: "private",
      contentStatus: "ready",
    });
  });

  it("returns an empty page for a user without notes", async () => {
    const h = createTestHarness();
    const view = await listNotes({
      container: h.container,
      input: { userId: "nobody" },
    });
    expect(view).toEqual({ items: [], count: 0 });
  });
});
