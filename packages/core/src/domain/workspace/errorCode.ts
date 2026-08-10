/**
 * Minimal slice of `WorkspaceErrorCode` (spec/domains/workspace.md).
 * Only the codes reachable from the value objects shipped in the
 * walking-skeleton slice are defined here; the full enum lands with the
 * Workspace domain slice (#3).
 */
export const WorkspaceErrorCode = {
  InvalidId: "WORKSPACE_INVALID_ID",
  InvalidRole: "WORKSPACE_INVALID_ROLE",
  InsufficientRole: "WORKSPACE_INSUFFICIENT_ROLE",
} as const;

export type WorkspaceErrorCode =
  (typeof WorkspaceErrorCode)[keyof typeof WorkspaceErrorCode];
