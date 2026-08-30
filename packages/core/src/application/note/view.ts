import type { Note } from "@repo/core/domain/note/note";
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
 * Import-provenance report (spec/usecases/note.md#getnote). In the
 * walking-skeleton slice every field is empty by construction: only
 * blank notes exist, so there is no body-derived reference to report,
 * and the supplying ports (`HtmlProcessor`, storage records) arrive with
 * the import slice. The shape ships now so the DTO is stable.
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

export type NoteListItemView = Readonly<{
  noteId: string;
  title: string;
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
  visibility: note.visibility.status,
  contentStatus: note.content.status,
  createdAt: note.createdAt,
  updatedAt: note.updatedAt,
});
