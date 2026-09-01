import {
  ConflictError,
  SystemError,
  SystemErrorCode,
} from "../../../application/errors";
import type { ScopeKey } from "../../../application/scope";
import type { NoteId } from "../../../domain/note/valueObject";
import type { TagAssignmentRepository } from "../../../domain/tag/ports/tagAssignmentRepository";
import type { TagAssignment } from "../../../domain/tag/tagAssignment";
import type { TagScope } from "../../../domain/tag/valueObject";
import type { ScopeStore } from "../store";
import { clone, compareStrings, duplicateKey } from "../support";

const TABLE = "tag_assignments";

/** `TagScope` and `ScopeKey` are the same shape by design; this names both. */
const scopeName = (scope: TagScope | ScopeKey): string =>
  scope.type === "user"
    ? `user:${scope.userId}`
    : `workspace:${scope.workspaceId}`;

/**
 * `tag_assignments` of one scope object.
 *
 * `scope_type` / `scope_id` is a scope key, not attribution: an
 * assignment lives in the scope of the note it is on
 * (spec/domains/tag.md), so a row whose scope names another object could
 * only have been written to the wrong place. Checked on the way in, like
 * `notes.owner_type` / `owner_id`; the read side needs no check because
 * the rows of one scope are a table of their own here.
 */
export function createMemoryTagAssignmentRepository(
  scope: ScopeStore,
): TagAssignmentRepository {
  const table = scope.tagAssignments;
  const bound = scopeName(scope.scope);

  const ofNote = (noteId: NoteId): readonly TagAssignment[] =>
    table
      .values()
      .filter((assignment) => assignment.noteId === noteId)
      .sort((a, b) => compareStrings(a.id, b.id));

  return {
    async insert(assignment: TagAssignment): Promise<void> {
      const named = scopeName(assignment.scope);
      if (named !== bound) {
        throw new SystemError(
          SystemErrorCode.DataIntegrityError,
          `Tag assignment ${assignment.id} is scoped to ${named} but the scope is ${bound}`,
        );
      }
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
