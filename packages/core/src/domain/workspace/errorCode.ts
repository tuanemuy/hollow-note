export const WorkspaceErrorCode = {
  InvalidId: "WORKSPACE_INVALID_ID",
  InvalidSlug: "WORKSPACE_INVALID_SLUG",
  SlugReserved: "WORKSPACE_SLUG_RESERVED",
  InvalidName: "WORKSPACE_INVALID_NAME",
  InvalidDescription: "WORKSPACE_INVALID_DESCRIPTION",
  InvalidRole: "WORKSPACE_INVALID_ROLE",
  InsufficientRole: "WORKSPACE_INSUFFICIENT_ROLE",
  SlugRequiredToPublish: "WORKSPACE_SLUG_REQUIRED_TO_PUBLISH",
  PublishedWorkspaceRequiresSlug: "WORKSPACE_PUBLISHED_REQUIRES_SLUG",
  LastOwnerCannotLeave: "WORKSPACE_LAST_OWNER_CANNOT_LEAVE",
  CannotChangeOwnRole: "WORKSPACE_CANNOT_CHANGE_OWN_ROLE",
  CannotRemoveSelf: "WORKSPACE_CANNOT_REMOVE_SELF",
  WorkspaceQuotaExceeded: "WORKSPACE_QUOTA_EXCEEDED",
  InvitationExpired: "WORKSPACE_INVITATION_EXPIRED",
} as const;

export type WorkspaceErrorCode =
  (typeof WorkspaceErrorCode)[keyof typeof WorkspaceErrorCode];
