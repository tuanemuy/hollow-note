import { beforeEach, describe, expect, it } from "vitest";
import { WITHDRAWN_AUTHOR_DISPLAY_NAME } from "../../domain/note/ports/localNoteProjectionWriter";
import type {
  ConformanceBackend,
  MakeConformanceBackend,
  ScopedConformancePorts,
} from "./backend";
import { makeProjectionEntry, noteId, scopeOf, userId } from "./fixtures";

/**
 * Shared conformance suite for the projection group: writers with the
 * generation-vector ordering, the snapshot reader, and the revision
 * counter (ADP-note-028..034, 055/056).
 */
export function describeNoteProjectionContract(
  backendName: string,
  makeBackend: MakeConformanceBackend,
): void {
  describe(`Note projection conformance [${backendName}]`, () => {
    let backend: ConformanceBackend;
    let scoped: ScopedConformancePorts;

    beforeEach(async () => {
      backend = await makeBackend();
      scoped = backend.forScope(scopeOf(1));
    });

    const entry = (n = 1) =>
      makeProjectionEntry(n, userId(1), backend.clock.now());

    it("ADP-note-028: replaceSnapshotIfNewer writes, rejects stale, flags incomparable", async () => {
      const written =
        await scoped.localNoteProjectionWriter.replaceSnapshotIfNewer(
          entry(),
          [],
          { projectionRevision: 2, authorVersion: 1, workspaceVersion: 0 },
        );
      expect(written).toBe("written");

      expect(
        await scoped.localNoteProjectionWriter.replaceSnapshotIfNewer(
          entry(),
          [],
          { projectionRevision: 2, authorVersion: 1, workspaceVersion: 0 },
        ),
      ).toBe("stale");
      expect(
        await scoped.localNoteProjectionWriter.replaceSnapshotIfNewer(
          entry(),
          [],
          { projectionRevision: 1, authorVersion: 1, workspaceVersion: 0 },
        ),
      ).toBe("stale");
      expect(
        await scoped.localNoteProjectionWriter.replaceSnapshotIfNewer(
          entry(),
          [],
          { projectionRevision: 3, authorVersion: 0, workspaceVersion: 0 },
        ),
      ).toBe("incomparable");
      expect(
        await scoped.localNoteProjectionWriter.replaceSnapshotIfNewer(
          entry(),
          [],
          { projectionRevision: 3, authorVersion: 2, workspaceVersion: 0 },
        ),
      ).toBe("written");
    });

    it("ADP-note-029/033: remove deletes the row the reader would return", async () => {
      await scoped.localNoteProjectionWriter.replaceSnapshotIfNewer(
        entry(),
        [{ name: "Tag", normalized: "tag" }],
        { projectionRevision: 1, authorVersion: 1, workspaceVersion: 0 },
      );
      const read = await scoped.noteProjectionSnapshotReader.read(noteId(1));
      expect(read?.entry.noteId).toBe(noteId(1));
      expect(read?.tags).toEqual([{ name: "Tag", normalized: "tag" }]);
      expect(read?.projectionRevision).toBe(1);

      await scoped.localNoteProjectionWriter.remove(noteId(1));
      expect(
        await scoped.noteProjectionSnapshotReader.read(noteId(1)),
      ).toBeNull();
    });

    it("ADP-note-055/056: redactAuthor replaces the author display on both planes and no-ops otherwise", async () => {
      const version = {
        projectionRevision: 1,
        authorVersion: 1,
        workspaceVersion: 0,
      };
      await scoped.localNoteProjectionWriter.replaceSnapshotIfNewer(
        entry(),
        [],
        version,
      );
      await backend.publicNoteProjectionWriter.replaceSnapshotIfNewer(
        makeProjectionEntry(1, userId(1), backend.clock.now(), {
          visibility: "public",
        }),
        [],
        { ...version, routeVersion: 1 },
      );
      const redaction = {
        noteId: noteId(1),
        createdBy: userId(1),
        redactionVersion: 4,
      };

      expect(
        await scoped.localNoteProjectionWriter.redactAuthor(redaction),
      ).toBe(true);
      expect(
        await backend.publicNoteProjectionWriter.redactAuthor(redaction),
      ).toBe(true);
      const redacted = await scoped.noteProjectionSnapshotReader.read(
        noteId(1),
      );
      expect(redacted?.entry.author).toEqual({
        displayName: WITHDRAWN_AUTHOR_DISPLAY_NAME,
        handle: null,
        version: 4,
      });
      const published = await backend.publicNoteQueryService.searchPublic({
        keyword: null,
        tagNames: [],
        ownerFilter: null,
        updatedWithin: null,
        cursor: null,
        limit: 10,
      });
      expect(published.items.map((item) => item.authorDisplayName)).toEqual([
        WITHDRAWN_AUTHOR_DISPLAY_NAME,
      ]);

      // Repeats, other authors, and absent rows change nothing.
      expect(
        await scoped.localNoteProjectionWriter.redactAuthor(redaction),
      ).toBe(false);
      expect(
        await scoped.localNoteProjectionWriter.redactAuthor({
          ...redaction,
          createdBy: userId(2),
          redactionVersion: 9,
        }),
      ).toBe(false);
      expect(
        await scoped.localNoteProjectionWriter.redactAuthor({
          ...redaction,
          noteId: noteId(2),
        }),
      ).toBe(false);

      // A note event from before the redaction cannot restore the name.
      expect(
        await scoped.localNoteProjectionWriter.replaceSnapshotIfNewer(
          entry(),
          [],
          { projectionRevision: 1, authorVersion: 1, workspaceVersion: 0 },
        ),
      ).toBe("stale");
      expect(
        (await scoped.noteProjectionSnapshotReader.read(noteId(1)))?.entry
          .author.displayName,
      ).toBe(WITHDRAWN_AUTHOR_DISPLAY_NAME);
    });

    it("ADP-note-034: bump increments the note's projection revision monotonically", async () => {
      expect(await scoped.noteProjectionRevisionStore.bump(noteId(1))).toBe(1);
      expect(await scoped.noteProjectionRevisionStore.bump(noteId(1))).toBe(2);
      expect(await scoped.noteProjectionRevisionStore.bump(noteId(2))).toBe(1);
    });

    it("ADP-note-030: a greater routeVersion resets the stored vector (workspace→personal move)", async () => {
      expect(
        await backend.publicNoteProjectionWriter.replaceSnapshotIfNewer(
          entry(),
          [],
          {
            projectionRevision: 5,
            authorVersion: 2,
            workspaceVersion: 7,
            routeVersion: 1,
          },
        ),
      ).toBe("written");

      // Same generation, lower vector: stale.
      expect(
        await backend.publicNoteProjectionWriter.replaceSnapshotIfNewer(
          entry(),
          [],
          {
            projectionRevision: 4,
            authorVersion: 2,
            workspaceVersion: 7,
            routeVersion: 1,
          },
        ),
      ).toBe("stale");

      // New generation: accepted even though workspaceVersion drops to 0.
      expect(
        await backend.publicNoteProjectionWriter.replaceSnapshotIfNewer(
          entry(),
          [],
          {
            projectionRevision: 1,
            authorVersion: 2,
            workspaceVersion: 0,
            routeVersion: 2,
          },
        ),
      ).toBe("written");

      // Old generation can no longer write.
      expect(
        await backend.publicNoteProjectionWriter.replaceSnapshotIfNewer(
          entry(),
          [],
          {
            projectionRevision: 9,
            authorVersion: 9,
            workspaceVersion: 9,
            routeVersion: 1,
          },
        ),
      ).toBe("stale");
    });

    it("ADP-note-031: removeIfNewer honours route and projection revisions", async () => {
      await backend.publicNoteProjectionWriter.replaceSnapshotIfNewer(
        entry(),
        [],
        {
          projectionRevision: 3,
          authorVersion: 1,
          workspaceVersion: 0,
          routeVersion: 1,
        },
      );

      expect(
        await backend.publicNoteProjectionWriter.removeIfNewer(noteId(1), 1, 2),
      ).toBe(false);
      expect(
        await backend.publicNoteProjectionWriter.removeIfNewer(noteId(1), 1, 3),
      ).toBe(true);
      expect(
        await backend.publicNoteProjectionWriter.removeIfNewer(noteId(1), 9, 9),
      ).toBe(false);
    });

    it("ADP-note-032: removeForPurge is idempotent under the operation", async () => {
      await backend.publicNoteProjectionWriter.replaceSnapshotIfNewer(
        entry(),
        [],
        {
          projectionRevision: 1,
          authorVersion: 1,
          workspaceVersion: 0,
          routeVersion: 1,
        },
      );
      const input = {
        noteId: noteId(1),
        operationId: "purge-1",
        routeVersion: 1,
        projectionRevision: 1,
      };
      await backend.publicNoteProjectionWriter.removeForPurge(input);
      await backend.publicNoteProjectionWriter.removeForPurge(input);
      expect(
        await backend.publicNoteProjectionWriter.removeIfNewer(noteId(1), 9, 9),
      ).toBe(false);
    });
  });
}
