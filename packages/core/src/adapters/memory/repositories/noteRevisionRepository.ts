import type { NoteRevision } from "../../../domain/note/noteRevision";
import type { NoteRevisionRepository } from "../../../domain/note/ports/noteRevisionRepository";
import type { NoteId, RevisionId } from "../../../domain/note/valueObject";
import type { ScopeStore } from "../store";
import { clone, compareStrings, duplicateKey } from "../support";

export function createMemoryNoteRevisionRepository(
  scope: ScopeStore,
): NoteRevisionRepository {
  const table = scope.noteRevisions;

  const newestFirst = (noteId: NoteId): readonly NoteRevision[] =>
    table
      .values()
      .filter((revision) => revision.noteId === noteId)
      .sort(
        (a, b) =>
          b.createdAt.getTime() - a.createdAt.getTime() ||
          compareStrings(b.id, a.id),
      );

  return {
    async insert(revision: NoteRevision): Promise<void> {
      if (table.has(revision.id)) {
        throw duplicateKey("note_revisions", revision.id);
      }
      table.set(revision.id, clone(revision));
    },

    async listByNote(
      noteId: NoteId,
      limit: number,
    ): Promise<readonly NoteRevision[]> {
      return newestFirst(noteId).slice(0, Math.max(0, limit)).map(clone);
    },

    async findById(id: RevisionId): Promise<NoteRevision | null> {
      const stored = table.get(id);
      return stored === undefined ? null : clone(stored);
    },

    async deleteOlderThanNewest(noteId: NoteId, keep: number): Promise<number> {
      const stale = newestFirst(noteId).slice(Math.max(0, keep));
      for (const revision of stale) {
        table.delete(revision.id);
      }
      return stale.length;
    },

    async deleteByNote(noteId: NoteId): Promise<number> {
      const targets = newestFirst(noteId);
      for (const revision of targets) {
        table.delete(revision.id);
      }
      return targets.length;
    },
  };
}
