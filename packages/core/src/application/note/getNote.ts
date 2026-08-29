import { NoteId } from "@repo/core/domain/note/valueObject";
import { NotFoundError } from "../errors";
import type { ServiceArgs } from "../types";
import { noteAccessPolicy, viewerFor } from "./accessControl";
import {
  emptyReferenceReport,
  type NoteDetailView,
  ownerOf,
  toNoteContentView,
} from "./view";

export type GetNoteInput = Readonly<{
  noteId: string;
  userId: string | null;
}>;

const noteNotFound = (): NotFoundError =>
  new NotFoundError("NOTE_NOT_FOUND", "Note not found");

/**
 * Reads a note for the detail view (UC-note-002,
 * spec/usecases/note.md#getnote). Viewer-context resolution: route →
 * scope-bound read → `NoteAccessPolicy.evaluate`; absence, someone
 * else's private note, and missing permission all collapse to
 * `NotFoundError("NOTE_NOT_FOUND")` so existence is never leaked.
 *
 * `shareUrl` is revealed (decrypted) only for a viewer with
 * `canChangeVisibility` on an unlisted note; anonymous / read-only
 * paths never decrypt. `references` is structurally empty in this slice
 * (see {@link emptyReferenceReport}).
 */
export async function getNote({
  container,
  input,
}: ServiceArgs<GetNoteInput>): Promise<NoteDetailView> {
  const { clock, config, scopeRouter, shareTokenProtector } = container;

  const noteId = NoteId.create(input.noteId);
  const { scope } = await scopeRouter.resolveNote(noteId);

  const versioned = await container.noteReaderFor(scope).findById(noteId);
  if (versioned === null) {
    throw noteNotFound();
  }
  const note = versioned.entity;

  const viewer = await viewerFor(container, note.owner, input.userId);
  const access = noteAccessPolicy.evaluate(
    note,
    viewer,
    { tokenHash: null, pass: null },
    clock.now(),
  );
  if (access.kind !== "granted") {
    throw noteNotFound();
  }

  const shareUrl =
    access.canChangeVisibility && note.visibility.status === "unlisted"
      ? `${config.appUrl}/s/${await shareTokenProtector.reveal(
          note.visibility.shareLink.protectedToken,
        )}`
      : null;

  return {
    noteId: note.id,
    title: note.title.value,
    content: toNoteContentView(note),
    styleMode: note.styleMode,
    visibility: note.visibility.status,
    hasSharePassword:
      note.visibility.status === "unlisted" &&
      note.visibility.shareLink.password !== null,
    shareUrl,
    ...ownerOf(note),
    createdBy: note.createdBy,
    sourceFileId: note.sourceFileId,
    headings: note.content.status === "ready" ? [...note.content.headings] : [],
    references: emptyReferenceReport(),
    permissions: {
      canEdit: access.canEdit,
      canDelete: access.canDelete,
      canChangeVisibility: access.canChangeVisibility,
    },
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
  };
}
