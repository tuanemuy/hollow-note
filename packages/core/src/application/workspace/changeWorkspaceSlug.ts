import { BusinessRuleError } from "@repo/core/domain/error";
import { UserId } from "@repo/core/domain/identity/valueObject";
import { WorkspaceErrorCode } from "@repo/core/domain/workspace/errorCode";
import { WorkspaceAuthorization } from "@repo/core/domain/workspace/services/workspaceAuthorization";
import {
  WorkspaceId,
  WorkspaceSlug,
} from "@repo/core/domain/workspace/valueObject";
import { Workspace } from "@repo/core/domain/workspace/workspace";
import { ConflictError } from "../errors";
import { ScopeKey } from "../scope";
import type { ServiceArgs } from "../types";
import { WORKSPACE_RESERVATION_TTL_MS } from "./createWorkspace";
import { projectWorkspaceDirectory } from "./directoryProjection";
import {
  resolveWorkspaceAccess,
  workspaceNotFound,
} from "./resolveWorkspaceAccess";
import type { WorkspaceSlugChangeView } from "./view";

export type ChangeWorkspaceSlugInput = Readonly<{
  workspaceId: string;
  userId: string;
  slug: string | null;
}>;

/**
 * Operation id of the slug reservation, derived rather than minted.
 *
 * A retry after a lost response must land on the row the previous attempt
 * took: a fresh id would collide with the workspace's own `reserved` row
 * and surface as `SLUG_ALREADY_USED` until its TTL lapsed. The slug is a
 * public URL segment, so embedding it carries nothing sensitive.
 */
const slugOperationId = (
  workspaceId: WorkspaceId,
  slug: WorkspaceSlug,
): string => `workspace.changeSlug:${workspaceId}:${slug}`;

/**
 * Changes the public slug of a workspace (UC-workspace-004,
 * spec/usecases/workspace.md#changeworkspaceslug, WS-07).
 *
 * Saga: reserve the new slug globally → the scope-local commit →
 * `activate` with the old slug as `releasing`, which frees it in the same
 * transaction that publishes the new one. The exchange is atomic by
 * contract, so the old public URL keeps resolving until the new one is
 * live and no window exists where both — or neither — resolve.
 *
 * Clearing the slug takes the other path: there is nothing to reserve, so
 * the old key is freed by `release` after the commit. A published
 * workspace cannot get there — the aggregate refuses to drop the slug its
 * public page is served from.
 *
 * Re-sending the slug the workspace already holds changes nothing and
 * emits nothing; it never touches the reservation, whose `active` row
 * already points here.
 *
 * The `workspace_directory` snapshot goes out last, once the reservation
 * has settled: the projection follows the authority on the key rather
 * than announcing a URL the reservation might still refuse.
 */
export async function changeWorkspaceSlug({
  container,
  input,
}: ServiceArgs<ChangeWorkspaceSlugInput>): Promise<WorkspaceSlugChangeView> {
  const {
    clock,
    logger,
    workspaceSlugReservationStore,
    scopeUnitOfWorkProvider,
  } = container;

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
  const nextSlug =
    input.slug === null ? null : WorkspaceSlug.create(input.slug);

  const observed = await container
    .workspaceReaderFor(scope)
    .workspace.findById(workspaceId);
  if (observed === null) {
    throw workspaceNotFound();
  }
  const previousSlug = observed.entity.slug;
  if (nextSlug === previousSlug) {
    return { workspaceId, slug: nextSlug, previousSlug };
  }
  const observedVersion = observed.entity.version;

  const now = clock.now();
  const reservation =
    nextSlug === null
      ? null
      : { slug: nextSlug, operationId: slugOperationId(workspaceId, nextSlug) };
  if (reservation !== null) {
    await workspaceSlugReservationStore.reserve({
      ...reservation,
      workspaceId,
      expiresAt: new Date(now.getTime() + WORKSPACE_RESERVATION_TTL_MS),
    });
  }

  let saved: Workspace;
  try {
    saved = await scopeUnitOfWorkProvider.run(scope, async (ctx) => {
      await ctx.cleanupAdmission.assertWritable();
      await ctx.cleanupAdmission.assertActorWritable(userId);

      const fresh = await ctx.workspaceRepository.findById(workspaceId);
      if (fresh === null) {
        throw workspaceNotFound();
      }
      if (fresh.entity.version !== observedVersion) {
        throw new ConflictError(
          "OPTIMISTIC_LOCK_FAILURE",
          "The workspace changed during the slug change",
        );
      }
      const changed = Workspace.changeSlug(fresh.entity, input.slug, now);
      await ctx.workspaceRepository.save(changed.entity, fresh.expectedVersion);
      ctx.collectEvents(changed.eventDrafts);
      return changed.entity;
    });
  } catch (error) {
    if (reservation !== null) {
      try {
        await workspaceSlugReservationStore.abandon(reservation);
      } catch (abandonError) {
        logger.error("[changeWorkspaceSlug] slug abandon failed", {
          cause: error,
          abandonError,
        });
      }
    }
    throw error;
  }

  if (reservation !== null) {
    const exchange = {
      ...reservation,
      workspaceId,
      releasing: previousSlug,
    };
    try {
      await workspaceSlugReservationStore.activate(exchange);
    } catch (cause) {
      logger.error("[changeWorkspaceSlug] activate lost; retrying once", {
        cause,
      });
      await workspaceSlugReservationStore.activate(exchange);
    }
  } else if (previousSlug !== null) {
    // No successor to hand the key to, so the standalone teardown frees
    // it; `release` is conditional on this workspace still holding it.
    await workspaceSlugReservationStore.release({
      slug: previousSlug,
      workspaceId,
    });
  }

  await projectWorkspaceDirectory(
    container,
    "[changeWorkspaceSlug] directory projection",
    saved,
  );

  return { workspaceId, slug: nextSlug, previousSlug };
}
