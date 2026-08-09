import type { NoteId } from "../valueObject";
import type {
  NoteProjectionEntry,
  ProjectedTagName,
} from "./localNoteProjectionWriter";

/**
 * Reads the current scope's note, tag set, and projection revision in a
 * single read transaction, so the consumer can assemble a consistent full
 * snapshot (author / workspace versions are resolved separately).
 *
 * Error contract: `SystemError(DatabaseError)`.
 */
export interface NoteProjectionSnapshotReader {
  read(noteId: NoteId): Promise<Readonly<{
    entry: NoteProjectionEntry;
    tags: readonly ProjectedTagName[];
    projectionRevision: number;
  }> | null>;
}
