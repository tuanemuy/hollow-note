import { BusinessRuleError } from "@repo/core/domain/error";
import { UserId } from "@repo/core/domain/identity/valueObject";
import { WorkspaceErrorCode } from "@repo/core/domain/workspace/errorCode";
import { WorkspaceAuthorization } from "@repo/core/domain/workspace/services/workspaceAuthorization";
import { WorkspaceId } from "@repo/core/domain/workspace/valueObject";
import { Workspace } from "@repo/core/domain/workspace/workspace";
import { ScopeKey } from "../scope";
import type { ServiceArgs } from "../types";
import { projectWorkspaceDirectory } from "./directoryProjection";
import {
  resolveWorkspaceAccess,
  workspaceNotFound,
} from "./resolveWorkspaceAccess";
import type { WorkspaceUnpublishedView } from "./view";

export type UnpublishWorkspaceInput = Readonly<{
  workspaceId: string;
  userId: string;
}>;

/**
 * Takes a workspace's public page down (UC-workspace-006,
 * spec/usecases/workspace.md#unpublishworkspace, WS-08).
 *
 * The slug survives, and so does its global reservation: re-publishing has
 * to land on the same public URL, and giving the key up is
 * `changeWorkspaceSlug`'s job. The public page stops resolving anyway,
 * because `getPublicWorkspace` gates on publication — on the
 * `workspace_directory` snapshot written here and on the aggregate behind
 * it — rather than on the reservation.
 *
 * Notes that are public in their own right stay readable at their own
 * URLs — workspace publication never governed them.
 */
export async function unpublishWorkspace({
  container,
  input,
}: ServiceArgs<UnpublishWorkspaceInput>): Promise<WorkspaceUnpublishedView> {
  const { clock, scopeUnitOfWorkProvider } = container;

  const access = await resolveWorkspaceAccess({
    container,
    input: { workspaceId: input.workspaceId, userId: input.userId },
  });
  if (access.role === null) {
    throw new BusinessRuleError(
      WorkspaceErrorCode.InsufficientRole,
      "Only a member can unpublish the workspace",
    );
  }
  WorkspaceAuthorization.ensureCan(access.role, "publishWorkspace");

  const workspaceId = WorkspaceId.create(input.workspaceId);
  const userId = UserId.create(input.userId);
  const now = clock.now();

  const stored = await scopeUnitOfWorkProvider.run(
    ScopeKey.workspace(workspaceId),
    async (ctx) => {
      await ctx.cleanupAdmission.assertWritable();
      await ctx.cleanupAdmission.assertActorWritable(userId);
      await ctx.workspaceOperationLockStore.assertWritable();

      const fresh = await ctx.workspaceRepository.findById(workspaceId);
      if (fresh === null) {
        throw workspaceNotFound();
      }
      if (!Workspace.isPublished(fresh.entity)) {
        return fresh.entity;
      }
      const next = Workspace.unpublish(fresh.entity, now);
      await ctx.workspaceRepository.save(next.entity, fresh.expectedVersion);
      ctx.collectEvents(next.eventDrafts);
      return next.entity;
    },
  );

  await projectWorkspaceDirectory(
    container,
    "[unpublishWorkspace] directory projection",
    stored,
  );

  return { workspaceId, publication: "private" };
}
