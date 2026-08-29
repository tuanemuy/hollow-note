import { BusinessRuleError } from "@repo/core/domain/error";
import { UserId } from "@repo/core/domain/identity/valueObject";
import { NoteOwner } from "@repo/core/domain/note/valueObject";
import { WorkspaceErrorCode } from "@repo/core/domain/workspace/errorCode";
import { WorkspaceAuthorization } from "@repo/core/domain/workspace/services/workspaceAuthorization";
import { WorkspaceId } from "@repo/core/domain/workspace/valueObject";
import {
  type PublishedWorkspace,
  Workspace,
} from "@repo/core/domain/workspace/workspace";
import type { RequestContainer } from "../di/types";
import { ScopeKey } from "../scope";
import type { ServiceArgs } from "../types";
import {
  resolveWorkspaceAccess,
  workspaceNotFound,
} from "./resolveWorkspaceAccess";
import type { WorkspacePublishedView } from "./view";

export type PublishWorkspaceInput = Readonly<{
  workspaceId: string;
  userId: string;
}>;

const COUNT_PAGE_LIMIT = 100;

/**
 * Public notes the workspace owns, for the "your page is empty" hint.
 *
 * Read from the workspace scope rather than the global public projection:
 * the search read model is not wired into the request container yet, and
 * the scope holds the authoritative visibility of every note it owns, so
 * the number is exact. Swap it for `PublicNoteQueryService.searchPublic`
 * (spec/usecases/workspace.md#publishworkspace 手順4) once that port
 * reaches the container — the projection is what the public page renders
 * from, and only it stays right once notes are searched across shards.
 */
async function countPublicNotes(
  container: RequestContainer,
  workspaceId: WorkspaceId,
): Promise<number> {
  const reader = container.noteReaderFor(ScopeKey.workspace(workspaceId));
  const owner = NoteOwner.workspace(workspaceId);
  let publicNotes = 0;
  let page = 1;
  for (;;) {
    const result = await reader.listByOwner(owner, "active", {
      page,
      limit: COUNT_PAGE_LIMIT,
    });
    publicNotes += result.items.filter(
      (note) => note.visibility.status === "public",
    ).length;
    if (page * COUNT_PAGE_LIMIT >= result.count) {
      return publicNotes;
    }
    page += 1;
  }
}

/**
 * Publishes a workspace's public page (UC-workspace-005,
 * spec/usecases/workspace.md#publishworkspace, WS-08).
 *
 * The slug is already claimed globally by the time this runs — publishing
 * flips the aggregate only, and the aggregate refuses to publish without
 * one. An already published workspace is a success with no write and no
 * event, so a double submit is harmless.
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

  return {
    workspaceId,
    publication: "published",
    publicUrl: `${config.appUrl}/w/${published.slug}`,
    publicNoteCount: await countPublicNotes(container, workspaceId),
  };
}
