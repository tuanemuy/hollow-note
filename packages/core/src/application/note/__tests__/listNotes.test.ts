import { WorkspaceErrorCode } from "@repo/core/domain/workspace/errorCode";
import { describe, expect, it } from "vitest";
import { createTestHarness } from "../../__tests__/helpers";
import {
  expectBusinessRule,
  expectNotFound,
  seedWorkspace,
} from "../../workspace/__tests__/harness";
import { createBlankNote } from "../createBlankNote";
import { listNotes } from "../listNotes";

const WORKSPACE = "workspace-1";

// Walking-skeleton glue: a minimal internal read over
// NoteRepository.listByOwner, replaced by the canonical listing later.
describe("listNotes", () => {
  it("lists the viewer's active personal notes with a total count", async () => {
    const h = createTestHarness();
    await createBlankNote({
      container: h.container,
      input: {
        userId: "u1",
        ownerType: "user",
        title: "One",
      },
    });
    await createBlankNote({
      container: h.container,
      input: {
        userId: "u1",
        ownerType: "user",
        title: "Two",
      },
    });
    await createBlankNote({
      container: h.container,
      input: {
        userId: "u2",
        ownerType: "user",
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

  // The workspace context is an authorization boundary, reached by
  // opening `/workspaces/:id/notes` directly.
  it("lists the workspace's notes for a member, not the member's personal ones", async () => {
    const h = createTestHarness();
    await seedWorkspace(h, {
      workspaceId: WORKSPACE,
      members: [
        { userId: "owner-1", role: "owner" },
        { userId: "u1", role: "viewer" },
      ],
    });
    const shared = await createBlankNote({
      container: h.container,
      input: {
        userId: "owner-1",
        ownerType: "workspace",
        ownerWorkspaceId: WORKSPACE,
        title: "Shared",
      },
    });
    await createBlankNote({
      container: h.container,
      input: {
        userId: "u1",
        ownerType: "user",
        title: "Personal",
      },
    });

    const view = await listNotes({
      container: h.container,
      input: {
        userId: "u1",
        ownerType: "workspace",
        ownerWorkspaceId: WORKSPACE,
      },
    });
    expect(view.count).toBe(1);
    expect(view.items.map((item) => item.noteId)).toEqual([shared.noteId]);
    expect(view.items.map((item) => item.title)).toEqual(["Shared"]);
  });

  it("refuses a non-member with InsufficientRole", async () => {
    const h = createTestHarness();
    await seedWorkspace(h, {
      workspaceId: WORKSPACE,
      members: [{ userId: "u1", role: "owner" }],
    });
    await createBlankNote({
      container: h.container,
      input: {
        userId: "u1",
        ownerType: "workspace",
        ownerWorkspaceId: WORKSPACE,
        title: "Shared",
      },
    });

    await expectBusinessRule(
      listNotes({
        container: h.container,
        input: {
          userId: "outsider",
          ownerType: "workspace",
          ownerWorkspaceId: WORKSPACE,
        },
      }),
      WorkspaceErrorCode.InsufficientRole,
    );
  });

  it("answers WORKSPACE_NOT_FOUND for a workspace that is not there", async () => {
    const h = createTestHarness();
    await expectNotFound(
      listNotes({
        container: h.container,
        input: {
          userId: "u1",
          ownerType: "workspace",
          ownerWorkspaceId: "no-such-workspace",
        },
      }),
      "WORKSPACE_NOT_FOUND",
    );
  });
});
