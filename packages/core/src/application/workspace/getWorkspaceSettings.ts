import { BusinessRuleError } from "@repo/core/domain/error";
import { WorkspaceErrorCode } from "@repo/core/domain/workspace/errorCode";
import { WorkspaceAuthorization } from "@repo/core/domain/workspace/services/workspaceAuthorization";
import { WorkspaceId } from "@repo/core/domain/workspace/valueObject";
import { ScopeKey } from "../scope";
import type { ServiceArgs } from "../types";
import {
  resolveWorkspaceAccess,
  workspaceNotFound,
} from "./resolveWorkspaceAccess";
import type { WorkspaceSettingsView } from "./view";

export type GetWorkspaceSettingsInput = Readonly<{
  workspaceId: string;
  userId: string;
}>;

/**
 * Reads a workspace's own settings for the three settings screens.
 *
 * The write-free counterpart of `updateWorkspaceProfile`, in the same
 * relation `getProfile` has to `updateProfile` on the identity plane: it
 * supplies every field that form edits, so the form never posts an empty
 * description it merely failed to load.
 *
 * Any member may read — the screens render read-only for a non-owner
 * rather than refusing — so authorization stops at membership and the
 * capability flags say what the role may then do. A non-member is
 * `InsufficientRole`, not a not-found: `resolveWorkspaceAccess` has
 * already proven the workspace exists, and collapsing the two would
 * mislead a member who lost their role mid-session.
 */
export async function getWorkspaceSettings({
  container,
  input,
}: ServiceArgs<GetWorkspaceSettingsInput>): Promise<WorkspaceSettingsView> {
  const access = await resolveWorkspaceAccess({
    container,
    input: { workspaceId: input.workspaceId, userId: input.userId },
  });
  const role = access.role;
  if (role === null) {
    throw new BusinessRuleError(
      WorkspaceErrorCode.InsufficientRole,
      "Only a member can read the workspace settings",
    );
  }

  const workspaceId = WorkspaceId.create(input.workspaceId);
  const stored = await container
    .workspaceReaderFor(ScopeKey.workspace(workspaceId))
    .workspace.findById(workspaceId);
  if (stored === null) {
    throw workspaceNotFound();
  }
  const workspace = stored.entity;

  return {
    workspaceId: workspace.id,
    name: workspace.name,
    description: workspace.description,
    avatarUrl: workspace.avatarUrl,
    slug: workspace.slug,
    publication: workspace.publication,
    role,
    canManage: WorkspaceAuthorization.can(role, "manageWorkspace"),
    canPublish: WorkspaceAuthorization.can(role, "publishWorkspace"),
    canDelete: WorkspaceAuthorization.can(role, "deleteWorkspace"),
  };
}
