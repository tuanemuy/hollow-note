import { Note } from "@repo/core/domain/note/note";
import { NoteId } from "@repo/core/domain/note/valueObject";
import { describe, expect, it } from "vitest";
import { createBlankNote } from "../../note/createBlankNote";
import { getNote } from "../../note/getNote";
import { getPublicWorkspace } from "../getPublicWorkspace";
import { publishWorkspace } from "../publishWorkspace";
import { unpublishWorkspace } from "../unpublishWorkspace";
import {
  createWorkspaceHarness,
  directoryRow,
  expectBusinessRule,
  expectNotFound,
  outboxPayloads,
  outboxRows,
  outboxTypes,
  removeWorkspaceRow,
  seedWorkspace,
  slugReservations,
  storedWorkspace,
  type TestHarness,
  withFailingDirectoryProjection,
  workspaceScope,
} from "./harness";

/** spec/testcases/workspace/unpublishWorkspace.md (TC-workspace-259〜265). */

const WORKSPACE = "workspace-1";
const OWNER = "owner-1";
const INSUFFICIENT_ROLE = "WORKSPACE_INSUFFICIENT_ROLE";

const unpublish = (h: TestHarness, userId = OWNER) =>
  unpublishWorkspace({
    container: h.container,
    input: { workspaceId: WORKSPACE, userId },
  });

const seed = (
  h: TestHarness,
  overrides: Parameters<typeof seedWorkspace>[1] = {},
) =>
  seedWorkspace(h, {
    workspaceId: WORKSPACE,
    name: "Team Alpha",
    slug: "team-alpha",
    publication: "published",
    members: [
      { userId: OWNER, role: "owner" },
      { userId: "editor-1", role: "editor" },
      { userId: "viewer-1", role: "viewer" },
    ],
    ...overrides,
  });

/** A public workspace note reachable through the global `note_routes`. */
async function seedPublicRoutedNote(h: TestHarness): Promise<string> {
  const created = await createBlankNote({
    container: h.container,
    input: {
      userId: OWNER,
      ownerType: "workspace",
      ownerWorkspaceId: WORKSPACE,
      title: "Public note",
    },
  });
  await h.container.scopeUnitOfWorkProvider.run(
    workspaceScope(WORKSPACE),
    async (ctx) => {
      const versioned = await ctx.noteRepository.findById(
        NoteId.create(created.noteId),
      );
      if (versioned === null || !Note.isActive(versioned.entity)) {
        throw new Error("expected the seeded active note");
      }
      const published = Note.makePublic(versioned.entity, h.clock.now());
      await ctx.noteRepository.save(
        published.entity,
        versioned.expectedVersion,
      );
    },
  );
  return created.noteId;
}

describe("unpublishWorkspace", () => {
  it("TC-workspace-259: an owner takes the page down and the unpublished event goes out", async () => {
    const h = createWorkspaceHarness();
    const seeded = await seed(h);

    const view = await unpublish(h);

    expect(view.publication).toBe("private");
    expect(storedWorkspace(h, WORKSPACE)).toMatchObject({
      publication: "private",
      version: seeded.workspace.version + 1,
    });
    expect(storedWorkspace(h, WORKSPACE)).not.toHaveProperty("publishedAt");
    expect(outboxTypes(h)).toEqual(["workspace.unpublished"]);
    expect(
      outboxPayloads<{ workspaceId: string }>(h, "workspace.unpublished"),
    ).toEqual([{ workspaceId: WORKSPACE }]);
    expect(directoryRow(h, WORKSPACE)).toMatchObject({
      publication: "private",
      sourceVersion: seeded.workspace.version + 1,
    });
  });

  /**
   * The mirror of the publish case, and the one that matters more: the
   * scope has taken the page down while the directory still advertises it
   * as published, and every read served from the projection — the
   * sitemap, the public enumeration — goes on showing it that way until
   * the request is sent again.
   */
  it("TC-workspace-322: a projection lost for good keeps the directory advertising a page the scope has taken down", async () => {
    const h = createWorkspaceHarness();
    const seeded = await seed(h);

    await expect(
      unpublishWorkspace({
        container: withFailingDirectoryProjection(h),
        input: { workspaceId: WORKSPACE, userId: OWNER },
      }),
    ).rejects.toThrow("directory shard unreachable");

    expect(storedWorkspace(h, WORKSPACE)).toMatchObject({
      publication: "private",
      version: seeded.workspace.version + 1,
    });
    expect(directoryRow(h, WORKSPACE)).toMatchObject({
      publication: "published",
      sourceVersion: seeded.workspace.version,
    });

    await expect(unpublish(h)).resolves.toMatchObject({
      publication: "private",
    });

    expect(directoryRow(h, WORKSPACE)).toMatchObject({
      publication: "private",
      sourceVersion: seeded.workspace.version + 1,
    });
    expect(storedWorkspace(h, WORKSPACE)?.version).toBe(
      seeded.workspace.version + 1,
    );
    expect(outboxTypes(h)).toEqual(["workspace.unpublished"]);
  });

  it("TC-workspace-260: the answer carries only the id and the publication", async () => {
    const h = createWorkspaceHarness();
    await seed(h);

    const view = await unpublish(h);

    expect(view).toEqual({ workspaceId: WORKSPACE, publication: "private" });
  });

  it("TC-workspace-261: the slug and its global reservation survive, so re-publishing restores the same URL", async () => {
    const h = createWorkspaceHarness();
    await seed(h);

    await unpublish(h);

    expect(storedWorkspace(h, WORKSPACE)?.slug).toBe("team-alpha");
    expect(slugReservations(h)).toEqual([
      expect.objectContaining({
        slug: "team-alpha",
        workspaceId: WORKSPACE,
        state: "active",
      }),
    ]);
    expect(directoryRow(h, WORKSPACE)?.slug).toBe("team-alpha");

    await expect(
      publishWorkspace({
        container: h.container,
        input: { workspaceId: WORKSPACE, userId: OWNER },
      }),
    ).resolves.toMatchObject({
      publication: "published",
      publicUrl: `${h.config.appUrl}/w/team-alpha`,
    });
  });

  it("TC-workspace-262: the public page stops resolving at the slug it was served from", async () => {
    const h = createWorkspaceHarness();
    await seed(h);

    await expect(
      getPublicWorkspace({
        container: h.container,
        input: { slug: "team-alpha" },
      }),
    ).resolves.toMatchObject({ workspaceId: WORKSPACE });

    await unpublish(h);

    await expectNotFound(
      getPublicWorkspace({
        container: h.container,
        input: { slug: "team-alpha" },
      }),
    );
  });

  it("TC-workspace-263: a note that is public in its own right stays readable at its own URL", async () => {
    const h = createWorkspaceHarness();
    await seed(h);
    const noteId = await seedPublicRoutedNote(h);

    await unpublish(h);

    await expect(
      getNote({ container: h.container, input: { noteId, userId: null } }),
    ).resolves.toMatchObject({ noteId, visibility: "public" });
  });

  it("TC-workspace-264: unpublishing a private workspace writes nothing and emits nothing", async () => {
    const h = createWorkspaceHarness();
    const seeded = await seed(h, { publication: "private" });

    const view = await unpublish(h);

    expect(view).toEqual({ workspaceId: WORKSPACE, publication: "private" });
    expect(storedWorkspace(h, WORKSPACE)?.version).toBe(
      seeded.workspace.version,
    );
    expect(outboxRows(h, "workspace.unpublished")).toEqual([]);
    expect(outboxTypes(h)).toEqual([]);
  });

  it("TC-workspace-265: an editor is InsufficientRole and the page stays up", async () => {
    const h = createWorkspaceHarness();
    await seed(h);

    await expectBusinessRule(unpublish(h, "editor-1"), INSUFFICIENT_ROLE);

    expect(storedWorkspace(h, WORKSPACE)?.publication).toBe("published");
    expect(directoryRow(h, WORKSPACE)?.publication).toBe("published");
    await expect(
      getPublicWorkspace({
        container: h.container,
        input: { slug: "team-alpha" },
      }),
    ).resolves.toMatchObject({ workspaceId: WORKSPACE });
  });

  it("TC-workspace-265: a viewer and a non-member are InsufficientRole too", async () => {
    const h = createWorkspaceHarness();
    await seed(h);

    await expectBusinessRule(unpublish(h, "viewer-1"), INSUFFICIENT_ROLE);
    await expectBusinessRule(unpublish(h, "outsider-1"), INSUFFICIENT_ROLE);
  });

  it("a workspace whose row the deletion saga removed is WORKSPACE_NOT_FOUND", async () => {
    const h = createWorkspaceHarness();
    await seed(h);
    removeWorkspaceRow(h, WORKSPACE);

    await expectNotFound(unpublish(h));
  });
});
