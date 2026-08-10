import type { NoteRevision } from "../noteRevision";
import type { NoteId, RevisionId } from "../valueObject";

/**
 * Revisions are immutable, so there is no `save`. The newest-20 retention
 * invariant is enforced by usecases calling `deleteOlderThanNewest`.
 *
 * Error contract: `SystemError(DatabaseError)`.
 */
export interface NoteRevisionRepository {
  insert(revision: NoteRevision): Promise<void>;
  /** Newest first, at most `limit` rows. */
  listByNote(noteId: NoteId, limit: number): Promise<readonly NoteRevision[]>;
  findById(id: RevisionId): Promise<NoteRevision | null>;
  /** Deletes all but the newest `keep` revisions; returns the deleted count. */
  deleteOlderThanNewest(noteId: NoteId, keep: number): Promise<number>;
  deleteByNote(noteId: NoteId): Promise<number>;
}
