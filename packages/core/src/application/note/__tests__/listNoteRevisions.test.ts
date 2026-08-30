import { isNotFoundError } from "@repo/core/application/errors";
import type { UserBatchReader } from "@repo/core/domain/identity/ports/userBatchReader";
import { User } from "@repo/core/domain/identity/user";
import { UserId } from "@repo/core/domain/identity/valueObject";
import { describe, expect, it } from "vitest";
import type { RequestContainer } from "../../di/types";
import { listNoteRevisions } from "../listNoteRevisions";
import {
  createPersonalNote,
  createTestHarness,
  createWorkspaceNote,
  MEMBER,
  OWNER,
  seedRevision,
  seedUser,
  seedWorkspace,
  type TestHarness,
  VIEWER,
} from "./editingHarness";

const list = (h: TestHarness, noteId: string, userId: string = OWNER) =>
  listNoteRevisions({ container: h.container, input: { noteId, userId } });

const seedMany = (
  h: TestHarness,
  noteId: string,
  count: number,
  createdBy: string = OWNER,
): void => {
  for (let index = 0; index < count; index += 1) {
    seedRevision(h, noteId, {
      id: `revision-${String(index).padStart(3, "0")}`,
      html: `<p>body ${index}</p>`,
      createdAt: new Date(Date.UTC(2026, 0, 1, 0, index)),
      createdBy,
    });
  }
};

describe("listNoteRevisions", () => {
  it("TC-note-220: returns the note's revisions newest first", async () => {
    const h = createTestHarness();
    seedUser(h, OWNER, "所有者");
    const noteId = await createPersonalNote(h);
    seedMany(h, noteId, 5);

    const view = await list(h, noteId);

    expect(view.revisions.map((revision) => revision.revisionId)).toEqual([
      "revision-004",
      "revision-003",
      "revision-002",
      "revision-001",
      "revision-000",
    ]);
    expect(view.revisions[0]?.createdByName).toBe("所有者");
  });

  it("TC-note-221: caps the list at the newest 20 even when more rows survive", async () => {
    const h = createTestHarness();
    seedUser(h, OWNER, "所有者");
    const noteId = await createPersonalNote(h);
    seedMany(h, noteId, 25);

    const view = await list(h, noteId);

    expect(view.revisions).toHaveLength(20);
    expect(view.revisions[0]?.revisionId).toBe("revision-024");
    expect(view.revisions[19]?.revisionId).toBe("revision-005");
  });

  it("TC-note-222: a note with no revisions lists nothing", async () => {
    const h = createTestHarness();
    const noteId = await createPersonalNote(h);

    expect((await list(h, noteId)).revisions).toEqual([]);
  });

  it("TC-note-220: revisions of another note are not listed", async () => {
    const h = createTestHarness();
    seedUser(h, OWNER, "所有者");
    const noteId = await createPersonalNote(h);
    const other = await createPersonalNote(h);
    seedMany(h, noteId, 2);
    seedRevision(h, other, {
      id: "revision-other",
      html: "<p>other</p>",
      createdAt: new Date(Date.UTC(2026, 0, 2)),
    });

    const view = await list(h, noteId);

    expect(view.revisions.map((revision) => revision.revisionId)).not.toContain(
      "revision-other",
    );
    expect(view.revisions).toHaveLength(2);
  });

  it("TC-note-224: an author whose account is gone still renders, with no display name", async () => {
    const h = createTestHarness();
    seedUser(h, OWNER, "所有者");
    const noteId = await createPersonalNote(h);
    seedRevision(h, noteId, {
      id: "revision-absent",
      html: "<p>a</p>",
      createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0)),
      createdBy: "user-vanished",
    });
    // A user whose deletion saga finished keeps a row but no PII.
    const deleting = User.beginDeletion(
      User.createVerified(
        {
          id: "user-erased",
          email: "erased@example.test",
          displayName: "消えた人",
        },
        h.clock.now(),
      ).entity,
      "operation-1",
      h.clock.now(),
    );
    h.backend.users.set(
      "user-erased",
      User.finalizeDeletion(deleting, "operation-1", h.clock.now()).entity,
    );
    seedRevision(h, noteId, {
      id: "revision-erased",
      html: "<p>b</p>",
      createdAt: new Date(Date.UTC(2026, 0, 1, 0, 1)),
      createdBy: "user-erased",
    });

    const view = await list(h, noteId);

    expect(view.revisions.map((revision) => revision.createdByName)).toEqual([
      null,
      null,
    ]);
    expect(view.revisions.map((revision) => revision.createdBy)).toEqual([
      "user-erased",
      "user-vanished",
    ]);
  });

  it("TC-note-225: authors are resolved in one deduplicated batch read", async () => {
    const h = createTestHarness();
    seedUser(h, OWNER, "所有者");
    seedUser(h, MEMBER, "共同編集者");
    const noteId = await createPersonalNote(h);
    for (let index = 0; index < 20; index += 1) {
      seedRevision(h, noteId, {
        id: `revision-${String(index).padStart(3, "0")}`,
        html: `<p>${index}</p>`,
        createdAt: new Date(Date.UTC(2026, 0, 1, 0, index)),
        createdBy: index % 2 === 0 ? OWNER : MEMBER,
      });
    }

    const calls: (readonly UserId[])[] = [];
    const real = h.container.userBatchReader;
    const reader: UserBatchReader = {
      resolveMany(ids) {
        calls.push(ids);
        return real.resolveMany(ids);
      },
    };
    const container: RequestContainer = {
      ...h.container,
      userBatchReader: reader,
    };

    const view = await listNoteRevisions({
      container,
      input: { noteId, userId: OWNER },
    });

    expect(calls).toHaveLength(1);
    expect([...(calls[0] ?? [])].sort()).toEqual(
      [UserId.create(MEMBER), UserId.create(OWNER)].sort(),
    );
    expect(
      new Set(view.revisions.map((revision) => revision.createdByName)),
    ).toEqual(new Set(["所有者", "共同編集者"]));
  });

  it("TC-note-226: a revision left by a regeneration reports that reason", async () => {
    const h = createTestHarness();
    seedUser(h, OWNER, "所有者");
    const noteId = await createPersonalNote(h);
    seedRevision(h, noteId, {
      id: "revision-regenerated",
      html: "<p>regenerated</p>",
      createdAt: new Date(Date.UTC(2026, 0, 1)),
      reason: "regeneration",
    });

    expect((await list(h, noteId)).revisions[0]?.reason).toBe("regeneration");
  });

  it("TC-note-227: each entry carries an excerpt, not the whole body", async () => {
    const h = createTestHarness();
    seedUser(h, OWNER, "所有者");
    const noteId = await createPersonalNote(h);
    const marker = "beginning-of-the-body";
    seedRevision(h, noteId, {
      id: "revision-long",
      html: `<p>${marker} ${"x".repeat(5000)}</p>`,
      createdAt: new Date(Date.UTC(2026, 0, 1)),
    });

    const entry = (await list(h, noteId)).revisions[0];

    expect(entry?.excerpt).toContain(marker);
    expect(entry?.excerpt.length).toBeLessThan(1000);
    expect(Object.keys(entry ?? {})).not.toContain("html");
  });

  it("TC-note-223: a workspace viewer is answered NOTE_NOT_FOUND", async () => {
    const h = createTestHarness();
    await seedWorkspace(h, [
      { userId: OWNER, role: "owner" },
      { userId: VIEWER, role: "viewer" },
    ]);
    const noteId = await createWorkspaceNote(h);

    await expect(list(h, noteId, VIEWER)).rejects.toSatisfy(isNotFoundError);
  });
});
