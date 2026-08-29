import { BusinessRuleError } from "@repo/core/domain/error";
import { AvatarUrl, UserId } from "@repo/core/domain/identity/valueObject";
import { WorkspaceErrorCode } from "@repo/core/domain/workspace/errorCode";
import { WorkspaceAuthorization } from "@repo/core/domain/workspace/services/workspaceAuthorization";
import { WorkspaceId } from "@repo/core/domain/workspace/valueObject";
import { Workspace } from "@repo/core/domain/workspace/workspace";
import { ConflictError } from "../errors";
import { ScopeKey } from "../scope";
import type { ServiceArgs } from "../types";
import { projectWorkspaceDirectory } from "./directoryProjection";
import {
  resolveWorkspaceAccess,
  workspaceNotFound,
} from "./resolveWorkspaceAccess";
import { toWorkspaceProfileView, type WorkspaceProfileView } from "./view";

export type UpdateWorkspaceProfileInput = Readonly<{
  workspaceId: string;
  userId: string;
  name?: string | null;
  description?: string | null;
  avatarUrl?: string | null;
}>;

/**
 * Updates a workspace's name, description and icon (UC-workspace-003,
 * spec/usecases/workspace.md#updateworkspaceprofile, WS-07).
 *
 * The write is scope-local — the profile names nothing the global plane
 * owns, so no reservation saga is involved — and the committed state is
 * then projected into `workspace_directory`, which is what the member's
 * workspace list renders. `workspace.profileUpdated`
 * is emitted by the aggregate only when the **name** actually changed, so
 * a description-only edit leaves the note read model alone.
 *
 * Concurrency is decided by the version observed before the transaction:
 * a profile write that committed in between makes this one stale and is
 * answered as `OPTIMISTIC_LOCK_FAILURE` rather than silently overwritten.
 */
export async function updateWorkspaceProfile({
  container,
  input,
}: ServiceArgs<UpdateWorkspaceProfileInput>): Promise<WorkspaceProfileView> {
  const { clock, config, scopeUnitOfWorkProvider } = container;

  const access = await resolveWorkspaceAccess({
    container,
    input: { workspaceId: input.workspaceId, userId: input.userId },
  });
  if (access.role === null) {
    throw new BusinessRuleError(
      WorkspaceErrorCode.InsufficientRole,
      "Only a member can manage the workspace",
    );
  }
  WorkspaceAuthorization.ensureCan(access.role, "manageWorkspace");

  const workspaceId = WorkspaceId.create(input.workspaceId);
  const userId = UserId.create(input.userId);
  const scope = ScopeKey.workspace(workspaceId);

  const observed = await container
    .workspaceReaderFor(scope)
    .workspace.findById(workspaceId);
  if (observed === null) {
    throw workspaceNotFound();
  }
  const observedVersion = observed.entity.version;

  // Built before the transaction so an invalid avatar URL never opens one.
  const patch = {
    ...(input.name !== undefined && input.name !== null
      ? { name: input.name }
      : {}),
    ...(input.description !== undefined && input.description !== null
      ? { description: input.description }
      : {}),
    ...(input.avatarUrl !== undefined
      ? {
          avatarUrl:
            input.avatarUrl === null
              ? null
              : AvatarUrl.create(input.avatarUrl, config.appUrl),
        }
      : {}),
  };

  const now = clock.now();
  const saved = await scopeUnitOfWorkProvider.run(scope, async (ctx) => {
    await ctx.cleanupAdmission.assertWritable();
    await ctx.cleanupAdmission.assertActorWritable(userId);

    const fresh = await ctx.workspaceRepository.findById(workspaceId);
    if (fresh === null) {
      throw workspaceNotFound();
    }
    if (fresh.entity.version !== observedVersion) {
      throw new ConflictError(
        "OPTIMISTIC_LOCK_FAILURE",
        "The workspace changed during the update",
      );
    }
    const updated = Workspace.updateProfile(fresh.entity, patch, now);
    await ctx.workspaceRepository.save(updated.entity, fresh.expectedVersion);
    ctx.collectEvents(updated.eventDrafts);
    return updated.entity;
  });

  await projectWorkspaceDirectory(
    container,
    "[updateWorkspaceProfile] directory projection",
    saved,
  );

  return toWorkspaceProfileView(saved);
}
