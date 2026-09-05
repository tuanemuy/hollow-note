import type {
  Pagination,
  PaginationResult,
} from "../../../domain/common/pagination";
import type { Note, TrashedNote } from "../../../domain/note/note";
import type {
  NoteLifecycleFilter,
  NoteRepository,
} from "../../../domain/note/ports/noteRepository";
import { type NoteId, NoteOwner } from "../../../domain/note/valueObject";
import type { ScopeStore } from "../store";
import { clone, compareStrings, createOccRepository } from "../support";

const matchesLifecycle = (note: Note, filter: NoteLifecycleFilter): boolean =>
  filter === "all" || note.lifecycle === filter;

export function createMemoryNoteRepository(scope: ScopeStore): NoteRepository {
  const table = scope.notes;
  const base = createOccRepository<Note, NoteId>("notes", table);

  const byOwner = (
    owner: NoteOwner,
    lifecycle: NoteLifecycleFilter,
  ): readonly Note[] =>
    table
      .values()
      .filter(
        (note) =>
          NoteOwner.equals(note.owner, owner) &&
          matchesLifecycle(note, lifecycle),
      );

  return {
    ...base,

    async listByIds(ids: readonly NoteId[]): Promise<readonly Note[]> {
      const result: Note[] = [];
      for (const id of ids) {
        const note = table.get(id);
        if (note !== undefined) {
          result.push(clone(note));
        }
      }
      return result;
    },

    async listPurgeable(
      now: Date,
      limit: number,
    ): Promise<readonly TrashedNote[]> {
      return table
        .values()
        .filter(
          (note): note is TrashedNote =>
            note.lifecycle === "trashed" &&
            note.purgeAfter.getTime() <= now.getTime(),
        )
        .sort(
          (a, b) =>
            a.purgeAfter.getTime() - b.purgeAfter.getTime() ||
            compareStrings(a.id, b.id),
        )
        .slice(0, Math.max(0, limit))
        .map(clone);
    },

    async findNextPurgeDeadline(): Promise<Date | null> {
      let earliest: number | null = null;
      for (const note of table.values()) {
        if (note.lifecycle !== "trashed") {
          continue;
        }
        const at = note.purgeAfter.getTime();
        if (earliest === null || at < earliest) {
          earliest = at;
        }
      }
      return earliest === null ? null : new Date(earliest);
    },

    async countByOwner(
      owner: NoteOwner,
      lifecycle: NoteLifecycleFilter,
    ): Promise<number> {
      return byOwner(owner, lifecycle).length;
    },

    async listByOwner(
      owner: NoteOwner,
      lifecycle: NoteLifecycleFilter,
      pagination: Pagination,
    ): Promise<PaginationResult<Note>> {
      const matched = [...byOwner(owner, lifecycle)].sort(
        (a, b) =>
          b.updatedAt.getTime() - a.updatedAt.getTime() ||
          compareStrings(b.id, a.id),
      );
      const start = (pagination.page - 1) * pagination.limit;
      return {
        items: matched.slice(start, start + pagination.limit).map(clone),
        count: matched.length,
      };
    },
  };
}
