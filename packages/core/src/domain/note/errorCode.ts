export const NoteErrorCode = {
  InvalidId: "NOTE_INVALID_ID",
  InvalidTitle: "NOTE_INVALID_TITLE",
  ContentTooLarge: "NOTE_CONTENT_TOO_LARGE",
  InvalidStyleMode: "NOTE_INVALID_STYLE_MODE",
  InvalidOwner: "NOTE_INVALID_OWNER",
  CannotPublishEmptyNote: "NOTE_CANNOT_PUBLISH_EMPTY_NOTE",
  NotUnlisted: "NOTE_NOT_UNLISTED",
  ShareLinkRequired: "NOTE_SHARE_LINK_REQUIRED",
  CannotCaptureEmptyContent: "NOTE_CANNOT_CAPTURE_EMPTY_CONTENT",
  CannotMoveWhileProcessing: "NOTE_CANNOT_MOVE_WHILE_PROCESSING",
  AccessDenied: "NOTE_ACCESS_DENIED",
  NoteIsTrashed: "NOTE_IS_TRASHED",
  NoteLockedByJob: "NOTE_LOCKED_BY_JOB",
} as const;

export type NoteErrorCode = (typeof NoteErrorCode)[keyof typeof NoteErrorCode];
