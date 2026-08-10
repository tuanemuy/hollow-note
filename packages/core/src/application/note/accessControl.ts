import { UserId } from "@repo/core/domain/identity/valueObject";
import type { NoteViewer } from "@repo/core/domain/note/services/noteAccessPolicy";
import { createNoteAccessPolicy } from "@repo/core/domain/note/services/noteAccessPolicy";
import type {
  WorkspaceAction,
  WorkspaceAuthorization,
} from "@repo/core/domain/workspace/services/workspaceAuthorization";
import type { WorkspaceRole } from "@repo/core/domain/workspace/valueObject";
import { SystemError, SystemErrorCode } from "../errors";

/**
 * Placeholder `WorkspaceAuthorization` for the walking-skeleton slice:
 * every note is personally owned and every viewer's `workspaceRole` is
 * `null`, so no policy evaluation can reach these methods. Reaching one
 * anyway means workspace state leaked in ahead of slice #3 — surfaced as
 * a data-integrity fault rather than a silent allow/deny.
 */
const unimplemented = (method: string): never => {
  throw new SystemError(
    SystemErrorCode.DataIntegrityError,
    `WorkspaceAuthorization.${method} is not implemented in this slice`,
  );
};

const placeholderWorkspaceAuthorization: WorkspaceAuthorization = {
  minimumRoleFor(action: WorkspaceAction): WorkspaceRole {
    return unimplemented(`minimumRoleFor(${action})`);
  },
  can(): boolean {
    return unimplemented("can");
  },
  ensureCan(): void {
    unimplemented("ensureCan");
  },
};

export const noteAccessPolicy = createNoteAccessPolicy(
  placeholderWorkspaceAuthorization,
);

/**
 * Builds the viewer for the walking-skeleton slice: personal viewers
 * only — the workspace role resolution arrives with slice #3.
 */
export const viewerFor = (userId: string | null): NoteViewer =>
  userId === null
    ? { kind: "anonymous" }
    : { kind: "user", userId: UserId.create(userId), workspaceRole: null };
