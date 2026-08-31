import { BusinessRuleError, RehydrationError } from "@repo/core/domain/error";
import { UserId } from "@repo/core/domain/identity/valueObject";
import { NoteErrorCode } from "./errorCode";
import type { ActiveNote } from "./note";
import {
  NoteHtml,
  NoteId,
  NoteTitle,
  RevisionId,
  StyleMode,
} from "./valueObject";

export type RevisionReason =
  | "manualEdit"
  | "regeneration"
  | "wysiwygConversion"
  | "restore";

const REVISION_REASONS: ReadonlySet<string> = new Set([
  "manualEdit",
  "regeneration",
  "wysiwygConversion",
  "restore",
]);

/**
 * Immutable snapshot of a note body taken on save. No OCC (never
 * updated). Retention — {@link NoteRevision.RETENTION} per note — is
 * enforced by the usecases via
 * `NoteRevisionRepository.deleteOlderThanNewest`, and read back with the
 * same bound by `listNoteRevisions`.
 */
export type NoteRevision = Readonly<{
  id: RevisionId;
  noteId: NoteId;
  html: NoteHtml;
  title: NoteTitle;
  styleMode: StyleMode;
  createdBy: UserId;
  createdAt: Date;
  reason: RevisionReason;
}>;

type ReconstructInput = Readonly<{
  id: string;
  noteId: string;
  html: string;
  title: string;
  titleOrigin: string;
  styleMode: string;
  createdBy: string;
  createdAt: Date;
  reason: string;
}>;

export const NoteRevision = {
  /**
   * The retention invariant itself: the newest 20 revisions per note.
   *
   * One number, because the writer's prune bound and the reader's cap
   * being the same number *is* the invariant — a copy that drifts makes
   * the list claim a depth the store no longer keeps (or hides one it
   * does).
   */
  RETENTION: 20,

  capture: (
    params: Readonly<{
      id: string;
      note: ActiveNote;
      createdBy: UserId;
      reason: RevisionReason;
    }>,
    now: Date,
  ): NoteRevision => {
    if (params.note.content.status !== "ready") {
      throw new BusinessRuleError(
        NoteErrorCode.CannotCaptureEmptyContent,
        "Cannot capture a revision of a note without a ready body",
      );
    }
    return {
      id: RevisionId.create(params.id),
      noteId: params.note.id,
      html: params.note.content.html,
      title: params.note.title,
      styleMode: params.note.styleMode,
      createdBy: params.createdBy,
      createdAt: now,
      reason: params.reason,
    };
  },

  reconstruct: (input: ReconstructInput): NoteRevision => {
    try {
      if (!REVISION_REASONS.has(input.reason)) {
        throw new BusinessRuleError(
          NoteErrorCode.InvalidId,
          `Invalid revision reason: ${input.reason}`,
        );
      }
      if (input.titleOrigin !== "auto" && input.titleOrigin !== "manual") {
        throw new BusinessRuleError(
          NoteErrorCode.InvalidId,
          `Invalid title origin: ${input.titleOrigin}`,
        );
      }
      return {
        id: RevisionId.create(input.id),
        noteId: NoteId.create(input.noteId),
        html: NoteHtml.create(input.html),
        title: NoteTitle.create(input.title, input.titleOrigin),
        styleMode: StyleMode.create(input.styleMode),
        createdBy: UserId.create(input.createdBy),
        createdAt: input.createdAt,
        reason: input.reason as RevisionReason,
      };
    } catch (error) {
      throw new RehydrationError(
        `Failed to reconstruct NoteRevision ${input.id}`,
        error,
      );
    }
  },
};
