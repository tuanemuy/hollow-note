import type { Note, TrashedNote } from "@repo/core/domain/note/note";
import type { RevisionReason } from "@repo/core/domain/note/noteRevision";

/**
 * DTO projections for the note usecases. Primitives only — branded value
 * objects widen naturally into these shapes.
 */

export type CreatedNoteView = Readonly<{
  noteId: string;
  title: string;
  ownerType: "user" | "workspace";
  ownerId: string;
  visibility: "private" | "unlisted" | "public";
  styleMode: "default" | "preserve";
  createdAt: Date;
}>;

export type NoteContentView = Readonly<{
  status: "processing" | "awaitingIntegration" | "failed" | "ready";
  html: string | null;
  failureReason: string | null;
}>;

export type NoteHeadingView = Readonly<{
  level: number;
  text: string;
  anchorId: string;
}>;

/**
 * Import-provenance report (spec/usecases/note.md#getnote). Every field
 * is still empty by construction: the report describes what a *reference
 * import* left behind, and the import itself is a Job seam with no
 * implementation, so no body carries the traces the report is composed
 * from and no fetch record exists to read the reasons out of. The shape
 * ships now so the DTO is stable.
 */
export type ReferenceReportView = Readonly<{
  imported: readonly Readonly<{ fileId: string; url: string | null }>[];
  inlinedStylesheets: readonly Readonly<{ url: string }>[];
  unavailableStylesheets: readonly Readonly<{
    url: string;
    reason: string | null;
  }>[];
  unresolved: readonly Readonly<{ url: string; reason: string | null }>[];
  removedCss: readonly Readonly<{ property: string; count: number }>[];
}>;

export const emptyReferenceReport = (): ReferenceReportView => ({
  imported: [],
  inlinedStylesheets: [],
  unavailableStylesheets: [],
  unresolved: [],
  removedCss: [],
});

export type NotePermissionsView = Readonly<{
  canEdit: boolean;
  canDelete: boolean;
  canChangeVisibility: boolean;
}>;

export type NoteDetailView = Readonly<{
  noteId: string;
  title: string;
  /**
   * OCC token the editing screen holds. Every editing usecase
   * (`updateNoteBody` / `applyTextNodeEdits` / `renameNote` /
   * `changeNoteStyleMode` / `restoreNoteRevision` / `trashNote` /
   * `restoreNote`) demands an `expectedVersion`, and this read is the
   * only one a screen can learn the first one from — without it the
   * editor's opening save has no version to send and the optimistic
   * lock can never start.
   */
  version: number;
  content: NoteContentView;
  styleMode: "default" | "preserve";
  visibility: "private" | "unlisted" | "public";
  hasSharePassword: boolean;
  shareUrl: string | null;
  ownerType: "user" | "workspace";
  ownerId: string;
  createdBy: string;
  sourceFileId: string | null;
  headings: readonly NoteHeadingView[];
  references: ReferenceReportView;
  permissions: NotePermissionsView;
  createdAt: Date;
  updatedAt: Date;
}>;

/**
 * One row of the note list (P-10).
 *
 * `version` is the row's OCC token, carried for the same reason
 * `TrashedNoteListItemView` carries one: the list owns the delete
 * (a list-membership change cannot be optimistically applied from the
 * row), and `trashNote` demands the version the screen actually saw.
 * Re-reading it server-side would make the check tautological.
 */
export type NoteListItemView = Readonly<{
  noteId: string;
  title: string;
  version: number;
  visibility: "private" | "unlisted" | "public";
  contentStatus: NoteContentView["status"];
  createdAt: Date;
  updatedAt: Date;
}>;

export type NoteListView = Readonly<{
  items: readonly NoteListItemView[];
  count: number;
}>;

/**
 * One allow-list removal, as the editor lists them after a save. The
 * `kind` is what lets the screen fold the report by category
 * (spec/testcases/note/updateNoteBody.md).
 */
export type RemovedNodeView = Readonly<{
  kind: "element" | "attribute" | "url" | "css";
  name: string;
  reason: string;
}>;

export type UpdatedNoteBodyView = Readonly<{
  noteId: string;
  version: number;
  removed: readonly RemovedNodeView[];
  referenceImportJobId: string | null;
}>;

export type SkippedTextNodeEditView = Readonly<{
  path: string;
  reason: string;
}>;

export type AppliedTextNodeEditsView = Readonly<{
  noteId: string;
  version: number;
  skipped: readonly SkippedTextNodeEditView[];
}>;

export type RenamedNoteView = Readonly<{
  noteId: string;
  title: string;
  version: number;
}>;

export type NoteStyleModeView = Readonly<{
  noteId: string;
  styleMode: "default" | "preserve";
  version: number;
}>;

/**
 * One entry of the revision list. `createdByName` is nullable because
 * `UserBatchReader.resolveMany` omits ids it cannot answer — an author
 * whose account is gone still has to render as a row. `excerpt` carries
 * the body, never the whole HTML: the list is a picker, and 20 full
 * bodies would be the note's size budget twenty times over.
 */
export type NoteRevisionView = Readonly<{
  revisionId: string;
  createdAt: Date;
  createdBy: string;
  createdByName: string | null;
  reason: RevisionReason;
  excerpt: string;
}>;

export type NoteRevisionListView = Readonly<{
  revisions: readonly NoteRevisionView[];
}>;

export type RestoredNoteRevisionView = Readonly<{
  noteId: string;
  version: number;
}>;

/**
 * Result of moving a note to the trash. `purgeAfter` is carried rather
 * than derived on the screen: the retention window belongs to the
 * domain (`TRASH_RETENTION_MS`), and the trash list shows the days left
 * against it.
 */
export type TrashedNoteView = Readonly<{
  noteId: string;
  trashedAt: Date;
  purgeAfter: Date;
}>;

/**
 * Result of restoring a note. The visibility is what the caller needs to
 * know: a restored note gets its former publication back, so the screen
 * has to say where the note is now reachable from.
 */
export type RestoredNoteView = Readonly<{
  noteId: string;
  visibility: "private" | "unlisted" | "public";
}>;

/**
 * Result of emptying the trash.
 *
 * `mode` is not decoration: it is what `purgedCount` has to be read
 * against. `"purged"` counts notes this request destroyed, `"scheduled"`
 * counts notes it enrolled into bulk-operation jobs — none of which have
 * run yet — so a response that carried the number alone would announce a
 * completed deletion that has not started. `jobIds` is the screen's link
 * into the job history and is empty on the inline path.
 */
export type EmptyTrashView = Readonly<{
  mode: "purged" | "scheduled";
  purgedCount: number;
  jobIds: readonly string[];
}>;

export const ownerOf = (
  note: Note,
): Readonly<{ ownerType: "user" | "workspace"; ownerId: string }> =>
  note.owner.type === "user"
    ? { ownerType: "user", ownerId: note.owner.userId }
    : { ownerType: "workspace", ownerId: note.owner.workspaceId };

export const toNoteContentView = (note: Note): NoteContentView => {
  switch (note.content.status) {
    case "ready":
      return { status: "ready", html: note.content.html, failureReason: null };
    case "failed":
      return {
        status: "failed",
        html: null,
        failureReason: note.content.reason,
      };
    case "processing":
    case "awaitingIntegration":
      return { status: note.content.status, html: null, failureReason: null };
  }
};

export const toNoteListItemView = (note: Note): NoteListItemView => ({
  noteId: note.id,
  title: note.title.value,
  version: note.version,
  visibility: note.visibility.status,
  contentStatus: note.content.status,
  createdAt: note.createdAt,
  updatedAt: note.updatedAt,
});

/**
 * One row of the trash (P-14).
 *
 * Carries the two things the trash screen cannot derive for itself: the
 * version every trash mutation demands as its `expectedVersion`
 * (`restoreNote` / `purgeNote`), and the retention deadline the remaining
 * days are counted against — `TRASH_RETENTION_MS` belongs to the domain,
 * so the screen reads the deadline rather than recomputing it.
 */
export type TrashedNoteListItemView = Readonly<{
  noteId: string;
  title: string;
  version: number;
  trashedAt: Date;
  purgeAfter: Date;
}>;

export type TrashedNoteListView = Readonly<{
  items: readonly TrashedNoteListItemView[];
  count: number;
}>;

export const toTrashedNoteListItemView = (
  note: TrashedNote,
): TrashedNoteListItemView => ({
  noteId: note.id,
  title: note.title.value,
  version: note.version,
  trashedAt: note.trashedAt,
  purgeAfter: note.purgeAfter,
});
