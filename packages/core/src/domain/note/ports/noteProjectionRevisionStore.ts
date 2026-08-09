import type { NoteId } from "../valueObject";

/**
 * Atomically increments a note's projection revision. Called in the same
 * local transaction as the authoritative-data change (note mutation, tag
 * assignment change, rename fan-out origin); the returned revision rides
 * on the outbox event for the projection's generation vector.
 *
 * Error contract: `SystemError(DatabaseError)`.
 */
export interface NoteProjectionRevisionStore {
  bump(noteId: NoteId): Promise<number>;
}
