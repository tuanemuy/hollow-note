import { Note } from "@repo/core/domain/note/note";
import { NoteId } from "@repo/core/domain/note/valueObject";
import { describe, expect, it } from "vitest";
import { isNotFoundError } from "../../errors";
import { createBlankNote } from "../../note/createBlankNote";
import { getNote } from "../../note/getNote";
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
  seedWorkspaceNotes,
  storedWorkspace,
  type TestHarness,
  workspaceScope,
} from "./harness";

/** spec/testcases/workspace/publishWorkspace.md (TC-workspace-202〜209). */

const WORKSPACE = "workspace-1";
const OWNER = "owner-1";
const INSUFFICIENT_ROLE = "WORKSPACE_INSUFFICIENT_ROLE";

const publish = (h: TestHarness, userId = OWNER) =>
  publishWorkspace({
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
    members: [
      { userId: OWNER, role: "owner" },
      { userId: "editor-1", role: "editor" },
      { userId: "viewer-1", role: "viewer" },
    ],
    ...overrides,
  });

/**
 * A workspace note that is reachable by its own URL — `getNote` resolves
 * through the global `note_routes`, so a row written straight into the
 * scope would be unreachable whatever its visibility says.
 */
async function seedRoutedNote(
  h: TestHarness,
  params: Readonly<{ title: string; visibility: "private" | "public" }>,
): Promise<string> {
  const created = await createBlankNote({
    container: h.container,
    input: {
      userId: OWNER,
      ownerType: "workspace",
      ownerWorkspaceId: WORKSPACE,
      title: params.title,
    },
  });
  if (params.visibility === "public") {
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
  }
  return created.noteId;
}

describe("publishWorkspace", () => {
  it("TC-workspace-202: an owner publishes a private workspace that already holds a slug", async () => {
    const h = createWorkspaceHarness();
    const seeded = await seed(h);

    const view = await publish(h);

    expect(view).toEqual({
      workspaceId: WORKSPACE,
      publication: "published",
      publicUrl: `${h.config.appUrl}/w/team-alpha`,
      publicNoteCount: 0,
    });
    expect(storedWorkspace(h, WORKSPACE)).toMatchObject({
      publication: "published",
      slug: "team-alpha",
      publishedAt: h.clock.now(),
      version: seeded.workspace.version + 1,
    });
    expect(outboxTypes(h)).toEqual(["workspace.published"]);
    expect(
      outboxPayloads<{ workspaceId: string; slug: string }>(
        h,
        "workspace.published",
      ),
    ).toEqual([{ workspaceId: WORKSPACE, slug: "team-alpha" }]);
    expect(directoryRow(h, WORKSPACE)).toMatchObject({
      publication: "published",
      slug: "team-alpha",
      sourceVersion: seeded.workspace.version + 1,
    });
  });

  it("TC-workspace-203: a workspace with no slug is SlugRequiredToPublish and stays private everywhere", async () => {
    const h = createWorkspaceHarness();
    await seed(h, { slug: null });

    await expectBusinessRule(publish(h), "WORKSPACE_SLUG_REQUIRED_TO_PUBLISH");

    expect(storedWorkspace(h, WORKSPACE)).toMatchObject({
      publication: "private",
      version: 0,
    });
    expect(directoryRow(h, WORKSPACE)?.publication).toBe("private");
    expect(outboxTypes(h)).toEqual([]);
  });

  it("TC-workspace-204: publishing with nothing public succeeds and reports 0", async () => {
    const h = createWorkspaceHarness();
    await seed(h);
    await seedWorkspaceNotes(h, WORKSPACE, { privateNotes: 4 });

    await expect(publish(h)).resolves.toMatchObject({
      publication: "published",
      publicNoteCount: 0,
    });
  });

  it("TC-workspace-205: the count is exactly the workspace's public notes", async () => {
    const h = createWorkspaceHarness();
    await seed(h);
    await seedWorkspaceNotes(h, WORKSPACE, {
      publicNotes: 3,
      privateNotes: 5,
    });
    // Another workspace's public notes must not leak into the count.
    await seedWorkspace(h, {
      workspaceId: "workspace-2",
      members: [{ userId: "other-owner", role: "owner" }],
    });
    await seedWorkspaceNotes(h, "workspace-2", { publicNotes: 7 });

    await expect(publish(h)).resolves.toMatchObject({ publicNoteCount: 3 });
  });

  it("TC-workspace-206: only the publish side carries publicNoteCount", async () => {
    const h = createWorkspaceHarness();
    await seed(h);
    await seedWorkspaceNotes(h, WORKSPACE, { publicNotes: 2 });

    const published = await publish(h);
    const unpublished = await unpublishWorkspace({
      container: h.container,
      input: { workspaceId: WORKSPACE, userId: OWNER },
    });

    expect(Object.keys(published).sort()).toEqual([
      "publicNoteCount",
      "publicUrl",
      "publication",
      "workspaceId",
    ]);
    expect(Object.keys(unpublished).sort()).toEqual([
      "publication",
      "workspaceId",
    ]);
  });

  it("TC-workspace-207: publishing an already published workspace writes nothing and emits nothing", async () => {
    const h = createWorkspaceHarness();
    const seeded = await seed(h, { publication: "published" });

    const view = await publish(h);

    expect(view).toMatchObject({
      publication: "published",
      publicUrl: `${h.config.appUrl}/w/team-alpha`,
    });
    expect(storedWorkspace(h, WORKSPACE)?.version).toBe(
      seeded.workspace.version,
    );
    expect(outboxRows(h, "workspace.published")).toEqual([]);
  });

  it("TC-workspace-208: an editor is InsufficientRole", async () => {
    const h = createWorkspaceHarness();
    await seed(h);

    await expectBusinessRule(publish(h, "editor-1"), INSUFFICIENT_ROLE);

    expect(storedWorkspace(h, WORKSPACE)?.publication).toBe("private");
    expect(directoryRow(h, WORKSPACE)?.publication).toBe("private");
  });

  it("TC-workspace-208: a viewer and a non-member are InsufficientRole too", async () => {
    const h = createWorkspaceHarness();
    await seed(h);

    await expectBusinessRule(publish(h, "viewer-1"), INSUFFICIENT_ROLE);
    await expectBusinessRule(publish(h, "outsider-1"), INSUFFICIENT_ROLE);
  });

  it("TC-workspace-209: publishing the workspace does not widen its notes", async () => {
    const h = createWorkspaceHarness();
    await seed(h);
    const privateNoteId = await seedRoutedNote(h, {
      title: "Kept private",
      visibility: "private",
    });
    const publicNoteId = await seedRoutedNote(h, {
      title: "Already public",
      visibility: "public",
    });

    await publish(h);

    await expect(
      getNote({
        container: h.container,
        input: { noteId: privateNoteId, userId: null },
      }),
    ).rejects.toSatisfy(
      (error: unknown) =>
        isNotFoundError(error) && error.code === "NOTE_NOT_FOUND",
    );
    await expect(
      getNote({
        container: h.container,
        input: { noteId: publicNoteId, userId: null },
      }),
    ).resolves.toMatchObject({ noteId: publicNoteId, visibility: "public" });
  });

  it("a workspace whose row the deletion saga removed is WORKSPACE_NOT_FOUND", async () => {
    const h = createWorkspaceHarness();
    await seed(h);
    removeWorkspaceRow(h, WORKSPACE);

    await expectNotFound(publish(h));
  });
});
