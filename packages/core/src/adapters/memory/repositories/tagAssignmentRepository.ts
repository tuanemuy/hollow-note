import { ConflictError } from "../../../application/errors";
import type { NoteId } from "../../../domain/note/valueObject";
import type { TagAssignmentRepository } from "../../../domain/tag/ports/tagAssignmentRepository";
import type { TagAssignment } from "../../../domain/tag/tagAssignment";
import type { ScopeStore } from "../store";
import { clone, compareStrings, duplicateKey } from "../support";

const TABLE = "tag_assignments";

export function createMemoryTagAssignmentRepository(
  scope: ScopeStore,
): TagAssignmentRepository {
  const table = scope.tagAssignments;

  const ofNote = (noteId: NoteId): readonly TagAssignment[] =>
    table
      .values()
      .filter((assignment) => assignment.noteId === noteId)
      .sort((a, b) => compareStrings(a.id, b.id));

  return {
    async insert(assignment: TagAssignment): Promise<void> {
      if (table.has(assignment.id)) {
        throw duplicateKey(TABLE, assignment.id);
      }
      if (
        table
          .values()
          .some(
            (stored) =>
              stored.tagId === assignment.tagId &&
              stored.noteId === assignment.noteId,
          )
      ) {
        throw new ConflictError(
          "ASSIGNMENT_ALREADY_EXISTS",
          `Tag ${assignment.tagId} is already assigned to note ${assignment.noteId}`,
        );
      }
      table.set(assignment.id, clone(assignment));
    },

    async listByNote(noteId: NoteId): Promise<readonly TagAssignment[]> {
      return ofNote(noteId).map(clone);
    },

    async deleteByNote(noteId: NoteId, limit: number): Promise<number> {
      const doomed = ofNote(noteId).slice(0, Math.max(0, limit));
      for (const assignment of doomed) {
        table.delete(assignment.id);
      }
      return doomed.length;
    },
  };
}
