import { BusinessRuleError } from "@repo/core/domain/error";
import { WorkspaceErrorCode } from "@repo/core/domain/workspace/errorCode";
import { WorkspaceAuthorization } from "@repo/core/domain/workspace/services/workspaceAuthorization";
import { WorkspaceId } from "@repo/core/domain/workspace/valueObject";
import { ScopeKey } from "../scope";
import type { ServiceArgs } from "../types";
import { resolveWorkspaceAccess } from "./resolveWorkspaceAccess";
import type { WorkspaceDeletionStatusView } from "./view";

export type GetWorkspaceDeletionStatusInput = Readonly<{
  workspaceId: string;
  userId: string;
}>;

/**
 * Reads how far a workspace deletion has got.
 *
 * The saga's own state is the answer, read from where it already lives:
 * `beginDeletion` moves the aggregate's lifecycle to
 * `deleting(operationId)` and the last local turn deletes the row, so
 * `active` / `deleting` / absent are exactly the three states the deletion
 * screen draws. No port is added and no manifest is consulted — the phases
 * after the Workspace row disappears (global cleanup, manifest compaction)
 * are invisible to a member who has already lost the workspace.
 *
 * The absent case answers `completed` without a membership check, because
 * by then there is no membership left anywhere to check: the manifest has
 * deleted the edges. It reveals only that the workspace is gone, which
 * `resolveWorkspaceAccess` already tells any signed-in caller through
 * `WORKSPACE_NOT_FOUND`. While the workspace exists, membership is
 * required and `canDelete` carries the role's verdict, so the screen can
 * render read-only for a non-owner rather than refusing.
 */
export async function getWorkspaceDeletionStatus({
  container,
  input,
}: ServiceArgs<GetWorkspaceDeletionStatusInput>): Promise<WorkspaceDeletionStatusView> {
  const workspaceId = WorkspaceId.create(input.workspaceId);
  const stored = await container
    .workspaceReaderFor(ScopeKey.workspace(workspaceId))
    .workspace.findById(workspaceId);
  if (stored === null) {
    return {
      workspaceId,
      status: "completed",
      operationId: null,
      canDelete: false,
    };
  }

  const access = await resolveWorkspaceAccess({
    container,
    input: { workspaceId: input.workspaceId, userId: input.userId },
  });
  const role = access.role;
  if (role === null) {
    throw new BusinessRuleError(
      WorkspaceErrorCode.InsufficientRole,
      "Only a member can read the workspace deletion status",
    );
  }

  const lifecycle = stored.entity.lifecycle;
  return {
    workspaceId: stored.entity.id,
    status: lifecycle.state === "deleting" ? "inProgress" : "none",
    operationId: lifecycle.state === "deleting" ? lifecycle.operationId : null,
    canDelete: WorkspaceAuthorization.can(role, "deleteWorkspace"),
  };
}
