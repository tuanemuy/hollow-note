import { BusinessRuleError } from "@repo/core/domain/error";
import { UserId } from "@repo/core/domain/identity/valueObject";
import { WorkspaceErrorCode } from "@repo/core/domain/workspace/errorCode";
import { WorkspaceAuthorization } from "@repo/core/domain/workspace/services/workspaceAuthorization";
import { WorkspaceId } from "@repo/core/domain/workspace/valueObject";
import {
  type PublishedWorkspace,
  Workspace,
} from "@repo/core/domain/workspace/workspace";
import { ScopeKey } from "../scope";
import type { ServiceArgs } from "../types";
import { projectWorkspaceDirectory } from "./directoryProjection";
import { ensureActorCan } from "./membershipMutation";
import { countPublicNotes } from "./publicNoteCount";
import {
  resolveWorkspaceAccess,
  workspaceNotFound,
} from "./resolveWorkspaceAccess";
import type { WorkspacePublishedView } from "./view";

export type PublishWorkspaceInput = Readonly<{
  workspaceId: string;
  userId: string;
}>;

/**
 * Publishes a workspace's public page (UC-workspace-005,
 * spec/usecases/workspace.md#publishworkspace, WS-08).
 *
 * The slug is already claimed globally by the time this runs — publishing
 * flips the aggregate, and the aggregate refuses to publish without one —
 * and the committed state is projected into `workspace_directory`, which
 * is what gates the public page and feeds the sitemap. An already
 * published workspace is a success with no write and no event, so a double
 * submit is harmless.
 *
 * Publishing a workspace does not touch the visibility of its notes: the
 * public page lists only notes that are public in their own right.
 */
export async function publishWorkspace({
  container,
  input,
}: ServiceArgs<PublishWorkspaceInput>): Promise<WorkspacePublishedView> {
  const { clock, config, scopeUnitOfWorkProvider } = container;

  const access = await resolveWorkspaceAccess({
    container,
    input: { workspaceId: input.workspaceId, userId: input.userId },
  });
  if (access.role === null) {
    throw new BusinessRuleError(
      WorkspaceErrorCode.InsufficientRole,
      "Only a member can publish the workspace",
    );
  }
  WorkspaceAuthorization.ensureCan(access.role, "publishWorkspace");

  const workspaceId = WorkspaceId.create(input.workspaceId);
  const userId = UserId.create(input.userId);
  const scope = ScopeKey.workspace(workspaceId);
  const now = clock.now();

  const published: PublishedWorkspace = await scopeUnitOfWorkProvider.run(
    scope,
    async (ctx) => {
      await ctx.cleanupAdmission.assertWritable();
      await ctx.cleanupAdmission.assertActorWritable(userId);
      await ctx.workspaceOperationLockStore.assertWritable();
      await ensureActorCan(ctx, workspaceId, userId, "publishWorkspace");

      const fresh = await ctx.workspaceRepository.findById(workspaceId);
      if (fresh === null) {
        throw workspaceNotFound();
      }
      if (Workspace.isPublished(fresh.entity)) {
        return fresh.entity;
      }
      const next = Workspace.publish(fresh.entity, now);
      await ctx.workspaceRepository.save(next.entity, fresh.expectedVersion);
      ctx.collectEvents(next.eventDrafts);
      return next.entity;
    },
  );

  await projectWorkspaceDirectory(
    container,
    "[publishWorkspace] directory projection",
    published,
  );

  return {
    workspaceId,
    publication: "published",
    publicUrl: `${config.appUrl}/w/${published.slug}`,
    publicNoteCount: await countPublicNotes(container, workspaceId),
  };
}
