import type {
  Pagination,
  PaginationResult,
} from "@repo/core/domain/common/pagination";
import type { TransactionalRepository } from "@repo/core/domain/common/transactionalRepository";
import type { Note, TrashedNote } from "../note";
import type { NoteId, NoteOwner } from "../valueObject";

export type NoteLifecycleFilter = "active" | "trashed" | "all";

/**
 * OCC-enforced persistence for the `Note` aggregate. The repository is
 * bound to the current `ScopeKey` and never scans across scopes — local
 * projection rebuilds enumerate via `listByOwner(currentScope, "all", …)`;
 * the public rebuild enters through the global `note_routes` instead.
 *
 * Error contract: `ConflictError("OPTIMISTIC_LOCK_FAILURE")`,
 * `SystemError(DatabaseError)`.
 */
export interface NoteRepository extends TransactionalRepository<Note, NoteId> {
  listByIds(ids: readonly NoteId[]): Promise<readonly Note[]>;
  /**
   * Trashed notes whose `purgeAfter <= now`, bounded by `limit` and
   * ordered `purgeAfter ASC, id ASC` — the order the retention sweep
   * reclaims them in, so the note that has waited longest goes first.
   */
  listPurgeable(now: Date, limit: number): Promise<readonly TrashedNote[]>;
  /**
   * The earliest `purgeAfter` among this scope's trashed notes, or
   * `null` when nothing is in the trash.
   *
   * Unlike `listPurgeable` this ignores the clock: it answers *when* the
   * retention sweep next has work, which is what the scope's alarm is
   * set from, so a window that has not opened yet is exactly the case it
   * exists for.
   */
  findNextPurgeDeadline(): Promise<Date | null>;
  countByOwner(
    owner: NoteOwner,
    lifecycle: NoteLifecycleFilter,
  ): Promise<number>;
  /**
   * Ordered `updatedAt DESC, id DESC`. The `id` tiebreak is what makes the
   * order total: offset paging over a partial order lets a row repeat on
   * one page and vanish from the next, which would make the projection
   * rebuild that enumerates through here drop notes without failing.
   */
  listByOwner(
    owner: NoteOwner,
    lifecycle: NoteLifecycleFilter,
    pagination: Pagination,
  ): Promise<PaginationResult<Note>>;
}
