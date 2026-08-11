import type { NoteId } from "../valueObject";
import type {
  AuthorRedaction,
  NoteProjectionEntry,
  ProjectedTagName,
  ProjectionVersion,
  ProjectionWriteResult,
} from "./localNoteProjectionWriter";

/**
 * Public-projection counterpart of `LocalNoteProjectionWriter`. The
 * `routeVersion` is compared first: a greater value means the owner
 * context switched to a new generation, so the stored projection /
 * author / workspace versions are reset and the input snapshot accepted;
 * only on an equal routeVersion are the remaining vector components
 * compared. This keeps workspace→personal moves (workspaceVersion
 * dropping to 0) from becoming permanently incomparable.
 *
 * Error contract: `SystemError(DatabaseError)`.
 */
export interface PublicNoteProjectionWriter {
  replaceSnapshotIfNewer(
    entry: NoteProjectionEntry,
    tags: readonly ProjectedTagName[],
    version: ProjectionVersion & Readonly<{ routeVersion: number }>,
  ): Promise<ProjectionWriteResult>;
  /** Returns whether a row was removed. */
  removeIfNewer(
    noteId: NoteId,
    routeVersion: number,
    projectionRevision: number,
  ): Promise<boolean>;
  /** Public counterpart of `LocalNoteProjectionWriter.redactAuthor`. */
  redactAuthor(input: AuthorRedaction): Promise<boolean>;
  /** Idempotent purge-side removal, acknowledged under the operation. */
  removeForPurge(
    input: Readonly<{
      noteId: NoteId;
      operationId: string;
      routeVersion: number;
      projectionRevision: number;
    }>,
  ): Promise<void>;
}
