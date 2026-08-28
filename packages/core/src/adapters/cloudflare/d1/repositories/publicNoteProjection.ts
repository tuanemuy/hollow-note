import type {
  AuthorRedaction,
  NoteProjectionEntry,
  ProjectedTagName,
  ProjectionVersion,
  ProjectionWriteResult,
} from "../../../../domain/note/ports/localNoteProjectionWriter";
import type { PublicNoteProjectionWriter } from "../../../../domain/note/ports/publicNoteProjectionWriter";
import type { NoteId } from "../../../../domain/note/valueObject";
import {
  compareVectors,
  PUBLIC_NOTE_SEARCH,
} from "../../projection/noteSearchRow";
import { createNoteSnapshotWriter } from "../../projection/snapshotWriter";
import { int } from "../../sql/row";
import type { SqlSession } from "../../sql/session";

/**
 * Global public read model (`public_note_search` and its two companions).
 *
 * Ordering is hierarchical: `route_version` is the owner-context
 * generation, so a greater one means the note moved and the stored
 * `(projection_revision, author_version, workspace_version)` describes a
 * context that no longer exists. It is reset rather than compared, which
 * is what keeps a workspace→personal move — where `workspaceVersion`
 * legitimately drops to 0 — from being permanently incomparable. Only
 * inside one generation does the vector decide.
 */
export function createD1PublicNoteProjectionWriter(
  session: SqlSession,
): PublicNoteProjectionWriter {
  const writer = createNoteSnapshotWriter(session, PUBLIC_NOTE_SEARCH);
  return {
    async replaceSnapshotIfNewer(
      entry: NoteProjectionEntry,
      tags: readonly ProjectedTagName[],
      version: ProjectionVersion & Readonly<{ routeVersion: number }>,
    ): Promise<ProjectionWriteResult> {
      const stored = await writer.readStored(entry.noteId);
      if (stored !== null) {
        const storedRoute = int(stored, "route_version");
        if (version.routeVersion < storedRoute) {
          return "stale";
        }
        if (version.routeVersion === storedRoute) {
          const verdict = compareVectors(version, stored);
          if (verdict !== "written") {
            return verdict;
          }
        }
      }
      await writer.replace(entry, tags, version, stored);
      return "written";
    },

    async removeIfNewer(
      noteId: NoteId,
      routeVersion: number,
      projectionRevision: number,
    ): Promise<boolean> {
      const stored = await writer.readStored(noteId);
      if (stored === null) {
        return false;
      }
      const storedRoute = int(stored, "route_version");
      const newer =
        routeVersion > storedRoute ||
        (routeVersion === storedRoute &&
          projectionRevision >= int(stored, "projection_revision"));
      if (!newer) {
        return false;
      }
      await writer.remove(noteId, stored);
      return true;
    },

    redactAuthor: (input: AuthorRedaction) => writer.redactAuthor(input),

    /**
     * The three inputs the port names beside `noteId` are unused on
     * purpose: the contract compares no generation here. The guard the
     * writer carries is not that comparison either — it only holds the
     * row still between the read and the withdrawal of its tokens, and a
     * redelivery re-reads and converges.
     */
    async removeForPurge(input): Promise<void> {
      await writer.remove(input.noteId, await writer.readStored(input.noteId));
    },
  };
}
