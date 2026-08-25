import type {
  AuthorRedaction,
  LocalNoteProjectionWriter,
  NoteProjectionEntry,
  ProjectedTagName,
  ProjectionVersion,
  ProjectionWriteResult,
} from "../../../../domain/note/ports/localNoteProjectionWriter";
import type { NoteProjectionRevisionStore } from "../../../../domain/note/ports/noteProjectionRevisionStore";
import type { NoteProjectionSnapshotReader } from "../../../../domain/note/ports/noteProjectionSnapshotReader";
import type { NoteId } from "../../../../domain/note/valueObject";
import { opaque, upsert } from "../../execution/writeSet";
import {
  compareVectors,
  decodeEntry,
  decodeTags,
  LOCAL_NOTE_SEARCH,
} from "../../projection/noteSearchRow";
import { createNoteSnapshotWriter } from "../../projection/snapshotWriter";
import { throwTranslated } from "../../sql/errors";
import { occGuard } from "../../sql/occGuard";
import { int } from "../../sql/row";
import type { SqlSession } from "../../sql/session";
import { statement } from "../../sql/statement";
import { SCOPE_TABLES } from "../schema";

/**
 * Scope-local read model of one note (`note_search` / `note_search_tags` /
 * `note_search_fts`), written only by the owner scope's projection task.
 */
export function createScopeLocalNoteProjectionWriter(
  session: SqlSession,
): LocalNoteProjectionWriter {
  const writer = createNoteSnapshotWriter(session, LOCAL_NOTE_SEARCH);
  return {
    async replaceSnapshotIfNewer(
      entry: NoteProjectionEntry,
      tags: readonly ProjectedTagName[],
      version: ProjectionVersion,
    ): Promise<ProjectionWriteResult> {
      const stored = await writer.readStored(entry.noteId);
      if (stored !== null) {
        const verdict = compareVectors(version, stored);
        if (verdict !== "written") {
          return verdict;
        }
      }
      await writer.replace(entry, tags, version, stored);
      return "written";
    },

    async remove(noteId: NoteId): Promise<void> {
      await writer.remove(noteId, await writer.readStored(noteId));
    },

    redactAuthor: (input: AuthorRedaction) => writer.redactAuthor(input),
  };
}

export function createScopeNoteProjectionSnapshotReader(
  session: SqlSession,
): NoteProjectionSnapshotReader {
  const writer = createNoteSnapshotWriter(session, LOCAL_NOTE_SEARCH);
  return {
    async read(noteId: NoteId) {
      const row = await writer.readStored(noteId);
      if (row === null) {
        return null;
      }
      return {
        entry: decodeEntry(row),
        tags: decodeTags(row),
        projectionRevision: int(row, "projection_revision"),
      };
    },
  };
}

/**
 * The projection counter, bumped in the very transaction that saves the
 * authoritative change and enqueues the event carrying the new value
 * ([ADR 027](../../../../../../spec/adr/027-projection-revision-numbering.md)).
 *
 * The read-then-write is closed by an OCC guard rather than by an
 * in-SQL `revision + 1`: the caller needs the number it produced, and a
 * lost update would hand two events the same revision and silently make
 * one of them unorderable against the other.
 */
export function createScopeNoteProjectionRevisionStore(
  session: SqlSession,
): NoteProjectionRevisionStore {
  const table = SCOPE_TABLES.noteProjectionRevisions;
  return {
    async bump(noteId: NoteId): Promise<number> {
      const stored = await session.readRow({
        table,
        key: noteId,
        statement: statement(
          `SELECT note_id, revision FROM ${table} WHERE note_id = ?`,
          noteId,
        ),
      });
      const current = stored === null ? 0 : int(stored, "revision");
      const next = current + 1;
      try {
        await session.write([
          opaque(
            occGuard(
              current === 0
                ? statement(
                    `SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM ${table} WHERE note_id = ?)`,
                    noteId,
                  )
                : statement(
                    `SELECT 1 FROM ${table} WHERE note_id = ? AND revision = ?`,
                    noteId,
                    current,
                  ),
            ),
          ),
          upsert({
            table,
            key: noteId,
            row: { note_id: noteId, revision: next },
            statement: statement(
              `INSERT INTO ${table} (note_id, revision) VALUES (?, ?)
               ON CONFLICT (note_id) DO UPDATE SET revision = excluded.revision`,
              noteId,
              next,
            ),
          }),
        ]);
      } catch (cause) {
        throwTranslated("the note projection revision", cause);
      }
      return next;
    },
  };
}
