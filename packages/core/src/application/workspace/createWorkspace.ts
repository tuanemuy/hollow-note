import { UserId } from "@repo/core/domain/identity/valueObject";
import { Membership } from "@repo/core/domain/workspace/membership";
import { MembershipPolicy } from "@repo/core/domain/workspace/services/membershipPolicy";
import {
  WorkspaceId,
  type WorkspaceSlug,
} from "@repo/core/domain/workspace/valueObject";
import { Workspace } from "@repo/core/domain/workspace/workspace";
import type { RequestContainer } from "../di/types";
import { ScopeKey } from "../scope";
import type { ServiceArgs } from "../types";
import type { CreatedWorkspaceView } from "./view";

export type CreateWorkspaceInput = Readonly<{
  userId: string;
  name: string;
  description?: string | null;
  slug?: string | null;
}>;

/** How long the global reservations hold while the scope commit runs. */
export const WORKSPACE_RESERVATION_TTL_MS = 10 * 60 * 1000;

/** One directory page; also the port's maximum. */
const EDGE_PAGE_LIMIT = 20;

/**
 * Owner edges the user holds in the global membership directory, counted
 * over the whole shard rather than one page.
 *
 * The count stops as soon as the quota is reached: the only question the
 * policy asks is "at least 20?", so paging past that would read rows no
 * decision depends on.
 *
 * `activating` edges are added because the quota is spec'd over active
 * **and** pending edges — a create whose scope commit never landed must
 * not free a slot for the next attempt. The reservation store cannot say
 * which role such an edge carries, so an in-flight join is counted as
 * owned; it settles within the reservation TTL and only ever errs towards
 * refusing, never towards letting a 21st workspace through.
 */
async function countOwnedWorkspaces(
  container: RequestContainer,
  userId: UserId,
): Promise<number> {
  const inFlight =
    await container.membershipDirectoryReservationStore.listActivatingByUser(
      userId,
      MembershipPolicy.maxOwnedWorkspaces,
    );
  let owned = inFlight.length;
  let cursor: string | null = null;
  do {
    if (owned >= MembershipPolicy.maxOwnedWorkspaces) {
      return owned;
    }
    const page = await container.userWorkspaceDirectory.listActiveByUser(
      userId,
      cursor,
      EDGE_PAGE_LIMIT,
    );
    owned += page.items.filter((edge) => edge.role === "owner").length;
    cursor = page.nextCursor;
  } while (cursor !== null);
  return owned;
}

/**
 * Frees both global reservations of a create that did not commit. Never
 * throws: the caller is already failing for another reason, and an
 * abandon that does not land only parks the rows until their TTL lapses.
 */
async function abandonReservations(
  container: RequestContainer,
  params: Readonly<{
    slug: WorkspaceSlug | null;
    operationId: string;
    cause: unknown;
  }>,
): Promise<void> {
  if (params.slug !== null) {
    try {
      await container.workspaceSlugReservationStore.abandon({
        slug: params.slug,
        operationId: params.operationId,
      });
    } catch (abandonError) {
      container.logger.error("[createWorkspace] slug abandon failed", {
        cause: params.cause,
        abandonError,
      });
    }
  }
  try {
    await container.membershipDirectoryReservationStore.abandon(
      params.operationId,
    );
  } catch (abandonError) {
    container.logger.error("[createWorkspace] edge abandon failed", {
      cause: params.cause,
      abandonError,
    });
  }
}

/**
 * Creates a workspace and joins its creator as owner (UC-workspace-002,
 * spec/usecases/workspace.md#createworkspace, WS-01).
 *
 * Saga: quota check → reserve the slug and the owner's directory edge on
 * the global plane → the workspace scope's unit of work (`Workspace` +
 * owner `Membership` + `workspace.created` / `membership.added`) →
 * activate both reservations under the same operation id. A commit that
 * did not land abandons both, so a failed create leaves neither a live
 * slug nor a directory edge; a lost activation response is retried once,
 * since every step is idempotent for its operation id.
 *
 * Every value object is constructed before the first reservation, so an
 * invalid name, description or slug can never leave global saga state
 * behind.
 *
 * The `workspace_directory` projection is not written here — no port
 * exposes it yet, and the directory is a projection of `workspace.created`
 * rather than a third leg of this saga.
 */
export async function createWorkspace({
  container,
  input,
}: ServiceArgs<CreateWorkspaceInput>): Promise<CreatedWorkspaceView> {
  const {
    clock,
    idGenerator,
    logger,
    workspaceSlugReservationStore,
    membershipDirectoryReservationStore,
    scopeUnitOfWorkProvider,
  } = container;

  const userId = UserId.create(input.userId);
  MembershipPolicy.ensureWorkspaceQuota(
    await countOwnedWorkspaces(container, userId),
  );

  const now = clock.now();
  const workspaceId = WorkspaceId.create(idGenerator.next());
  const operationId = idGenerator.next();

  const created = Workspace.create(
    {
      id: workspaceId,
      ownerId: userId,
      name: input.name,
      description: input.description ?? "",
      slug: input.slug ?? null,
    },
    now,
  );
  const workspace = created.entity;
  const joined = Membership.create(
    { id: idGenerator.next(), workspaceId, userId, role: "owner" },
    now,
  );

  const expiresAt = new Date(now.getTime() + WORKSPACE_RESERVATION_TTL_MS);
  const slug = workspace.slug;
  if (slug !== null) {
    await workspaceSlugReservationStore.reserve({
      slug,
      workspaceId,
      operationId,
      expiresAt,
    });
  }
  try {
    await membershipDirectoryReservationStore.reserveAndClaimActivation({
      operationId,
      userId,
      workspaceId,
      membershipId: joined.entity.id,
      role: "owner",
      expiresAt,
    });
  } catch (error) {
    await abandonReservations(container, { slug, operationId, cause: error });
    throw error;
  }

  try {
    await scopeUnitOfWorkProvider.run(
      ScopeKey.workspace(workspaceId),
      async (ctx) => {
        await ctx.workspaceRepository.insert(workspace);
        await ctx.membershipRepository.insert(joined.entity);
        ctx.collectEvents([...created.eventDrafts, ...joined.eventDrafts]);
      },
    );
  } catch (error) {
    await abandonReservations(container, { slug, operationId, cause: error });
    throw error;
  }

  if (slug !== null) {
    try {
      await workspaceSlugReservationStore.activate({
        slug,
        workspaceId,
        operationId,
        releasing: null,
      });
    } catch (cause) {
      logger.error("[createWorkspace] slug activate lost; retrying once", {
        cause,
      });
      await workspaceSlugReservationStore.activate({
        slug,
        workspaceId,
        operationId,
        releasing: null,
      });
    }
  }
  try {
    await membershipDirectoryReservationStore.activate(operationId);
  } catch (cause) {
    logger.error("[createWorkspace] edge activate lost; retrying once", {
      cause,
    });
    await membershipDirectoryReservationStore.activate(operationId);
  }

  return {
    workspaceId,
    name: workspace.name,
    slug: workspace.slug,
    publication: workspace.publication,
    role: joined.entity.role,
  };
}
