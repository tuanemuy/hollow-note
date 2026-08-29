import { BusinessRuleError } from "@repo/core/domain/error";
import { UserId } from "@repo/core/domain/identity/valueObject";
import { WorkspaceErrorCode } from "@repo/core/domain/workspace/errorCode";
import { WorkspaceAuthorization } from "@repo/core/domain/workspace/services/workspaceAuthorization";
import {
  WorkspaceId,
  WorkspaceSlug,
} from "@repo/core/domain/workspace/valueObject";
import { Workspace } from "@repo/core/domain/workspace/workspace";
import type { RequestContainer } from "../di/types";
import { ConflictError } from "../errors";
import { ScopeKey } from "../scope";
import type { ServiceArgs } from "../types";
import { WORKSPACE_RESERVATION_TTL_MS } from "./createWorkspace";
import { projectWorkspaceDirectory } from "./directoryProjection";
import { retryOnce } from "./invitation";
import { ensureActorCan } from "./membershipMutation";
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

/** The reservation one invocation of this usecase takes. */
type SlugReservation = Readonly<{
  slug: WorkspaceSlug;
  operationId: string;
  attemptId: string;
}>;

/**
 * The slug the directory still advertises for this workspace, when it is
 * not the one the caller is settling on. Anything else — no row, a row
 * the shard cannot answer for, a row already on that slug — is `null`.
 *
 * ## The rule every path that gives a key up follows
 *
 * Two values can name the key this workspace holds on the global plane,
 * and **neither is reliable on its own**. The scope's own slug is what
 * the scope believes; the directory row is what the last projection that
 * landed announced. They come apart in both directions, and each window
 * strands the candidate the other one names:
 *
 * - an `activate` lost for good moves the scope while the global plane
 *   stays put, so the key still held is the one the directory names;
 * - a projection lost for good moves the global plane while the
 *   directory stays put, so the key still held is the one the scope
 *   names — and nothing re-sends that snapshot.
 *
 * So no path picks one. Every path frees **both** candidates, which
 * costs nothing when a candidate is stale: `activate(releasing)` and
 * `release` each free a key solely while it is `active` for this
 * workspace (`WorkspaceSlugReservationStore`), so a wrong guess is a
 * call that writes nothing. Guessing wrong the other way is not
 * recoverable — an `active` reservation carries no expiry and no sweep
 * collects it, so a key nobody frees is lost to every workspace in the
 * service.
 *
 * The key the scope is leaving is handed to `activate` as `releasing`
 * rather than freed on its own, so the old public URL keeps resolving
 * until the new one is live; the other candidate is freed beside it.
 * Both are freed **before** the projection, since a snapshot landing
 * first overwrites the directory row and with it the only record of the
 * advertised candidate.
 *
 * `deleteWorkspace` reads this for the same reason and carries the
 * answer on the deletion turn, being the last request that can free
 * either key.
 */
export async function advertisedSlug(
  container: RequestContainer,
  workspaceId: WorkspaceId,
  current: WorkspaceSlug | null,
): Promise<WorkspaceSlug | null> {
  const resolved = await container.workspaceDirectoryBatchReader.resolveMany([
    workspaceId,
  ]);
  const row = resolved.get(workspaceId);
  if (row === undefined || row.state !== "active") {
    return null;
  }
  const advertised = row.entry.entity.slug;
  return advertised === null || advertised === current ? null : advertised;
}

/**
 * Frees the candidate keys of `advertisedSlug`'s rule that no `activate`
 * is carrying, skipping the absent ones and never asking twice for the
 * same key.
 *
 * Each call is retried for the reason the activation is: it runs after
 * the commit that dropped the slug, and an `active` reservation has no
 * expiry, so a lost response strands the key against every workspace in
 * the service.
 */
async function releaseKeys(
  container: RequestContainer,
  workspaceId: WorkspaceId,
  candidates: readonly (WorkspaceSlug | null)[],
): Promise<void> {
  const freed = new Set<WorkspaceSlug>();
  for (const slug of candidates) {
    if (slug === null || freed.has(slug)) {
      continue;
    }
    freed.add(slug);
    await retryOnce(
      container.logger,
      "[changeWorkspaceSlug] slug release",
      () =>
        container.workspaceSlugReservationStore.release({ slug, workspaceId }),
    );
  }
}

/**
 * Re-drives the global half of a change whose scope commit already
 * landed: the key this workspace's slug needs — taken or given up — and
 * the directory row that advertises it.
 *
 * Those steps come after the local commit, so all of them can be lost
 * while the scope has already moved. Sending the slug the workspace
 * already holds is the request that repairs them — without this it
 * answered success while the reservation stayed `reserved`, which leaves
 * the new public URL resolving to nothing for good, since no other call
 * reserves it again.
 *
 * Clearing to `null` has the mirrored failure: the scope holds no slug
 * while the global plane still holds an `active` row for the one it left,
 * and an `active` row carries no expiry, so that key would be
 * unobtainable by *any* workspace forever. Re-sending `null` releases it.
 *
 * The re-reservation is skipped once the global plane already agrees with
 * the scope, so an unchanged slug stays a no-op there. The **release** is
 * not covered by that skip and is evaluated on every call: the state this
 * repairs is precisely one where the two planes disagree about which key
 * is held, and a skip keyed on the new slug alone would leave the other
 * candidate with no request that ever looks at it again.
 *
 * The deletion barrier is read before taking a key, for the reason the
 * invitation sagas read it: a scope that has accepted a deletion must not
 * have a global key claimed back for it, and the deletion frees exactly
 * this row. Giving a key up does not ask that question — it is the same
 * direction the deletion moves in.
 *
 * Which keys are given up, and in what order against the projection, is
 * `advertisedSlug`'s rule.
 */
async function repairSettledSlug(
  container: RequestContainer,
  params: Readonly<{
    scope: ScopeKey;
    workspaceId: WorkspaceId;
    slug: WorkspaceSlug | null;
    workspace: Workspace;
    attemptId: string;
    expiresAt: Date;
  }>,
): Promise<void> {
  const { workspaceSlugReservationStore: reservations, logger } = container;
  const { slug, workspaceId } = params;
  const advertised = await advertisedSlug(container, workspaceId, slug);
  if (
    slug !== null &&
    (await reservations.resolveActive(slug)) !== workspaceId
  ) {
    await container.workspaceReaderFor(params.scope).admission.assertWritable();
    const operationId = slugOperationId(workspaceId, slug);
    await reservations.reserve({
      slug,
      workspaceId,
      operationId,
      attemptId: params.attemptId,
      expiresAt: params.expiresAt,
    });
    await retryOnce(logger, "[changeWorkspaceSlug] slug activate", () =>
      reservations.activate({
        slug,
        workspaceId,
        operationId,
        releasing: advertised,
      }),
    );
  }
  await releaseKeys(container, workspaceId, [advertised]);
  await projectWorkspaceDirectory(
    container,
    "[changeWorkspaceSlug] directory projection",
    params.workspace,
  );
}

/**
 * Gives the new slug's reservation back — but only when **this** attempt
 * is the one that failed.
 *
 * The operation id is derived from `(workspaceId, slug)`, so every attempt
 * at the same rename shares one reservation row. `attemptId` is what tells
 * them apart: the row belongs to whichever attempt reserved it last, and
 * the port refuses a compensation from any other. Without that, an attempt
 * that failed for a reason of its own — a role lost between two reads, a
 * barrier that refused it — would drop the row a still-running attempt is
 * about to activate.
 *
 * A failing compensation is logged and swallowed, so the caller still sees
 * the original error; the row it could not drop is reclaimed by expiry
 * recovery.
 */
async function abandonSlugReservation(
  container: RequestContainer,
  cause: unknown,
  reservation: SlugReservation,
): Promise<void> {
  try {
    await container.workspaceSlugReservationStore.abandon(reservation);
  } catch (abandonError) {
    container.logger.error("[changeWorkspaceSlug] slug abandon failed", {
      cause,
      abandonError,
    });
  }
}

/**
 * Changes the public slug of a workspace (UC-workspace-004,
 * spec/usecases/workspace.md#changeworkspaceslug, WS-07).
 *
 * Saga: reserve the new slug globally → the scope-local commit →
 * `activate` with the key being given up as `releasing`, which frees it in
 * the same transaction that publishes the new one. The exchange is atomic
 * by contract, so the old public URL keeps resolving until the new one is
 * live and no window exists where both — or neither — resolve.
 *
 * Clearing the slug takes the other path: there is nothing to reserve, so
 * the key is freed by `release` after the commit. A published workspace
 * cannot get there — the aggregate refuses to drop the slug its public
 * page is served from.
 *
 * Which keys either path gives up — and why picking one of the two
 * candidates is what strands the other for good — is `advertisedSlug`'s
 * rule.
 *
 * Re-sending the slug the workspace already holds — `null` included —
 * changes nothing and emits nothing while the global plane agrees with
 * the scope. It is also the repair path when it does not: a reservation
 * left `reserved`, a key left `active` for a slug the scope has dropped,
 * or a directory row left on the old slug is re-driven there, since the
 * steps that write them come after a commit that cannot be taken back.
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
  const observedVersion = observed.entity.version;

  const now = clock.now();
  const expiresAt = new Date(now.getTime() + WORKSPACE_RESERVATION_TTL_MS);
  const attemptId = container.idGenerator.next();

  if (nextSlug === previousSlug) {
    await repairSettledSlug(container, {
      scope,
      workspaceId,
      slug: nextSlug,
      workspace: observed.entity,
      attemptId,
      expiresAt,
    });
    return { workspaceId, slug: nextSlug, previousSlug };
  }

  const reservation: SlugReservation | null =
    nextSlug === null
      ? null
      : {
          slug: nextSlug,
          operationId: slugOperationId(workspaceId, nextSlug),
          attemptId,
        };
  if (reservation !== null) {
    await workspaceSlugReservationStore.reserve({
      slug: reservation.slug,
      workspaceId,
      operationId: reservation.operationId,
      attemptId: reservation.attemptId,
      expiresAt,
    });
  }

  let saved: Workspace;
  try {
    saved = await scopeUnitOfWorkProvider.run(scope, async (ctx) => {
      await ctx.cleanupAdmission.assertWritable();
      await ctx.cleanupAdmission.assertActorWritable(userId);
      await ctx.workspaceOperationLockStore.assertWritable();
      await ensureActorCan(ctx, workspaceId, userId, "manageWorkspace");

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
      await abandonSlugReservation(container, error, reservation);
    }
    throw error;
  }

  const advertised = await advertisedSlug(container, workspaceId, nextSlug);

  if (reservation !== null) {
    // The advertised candidate is freed on its own only when it is not
    // the one the exchange is carrying: releasing `previousSlug` here
    // would open the window between the two URLs that the exchange
    // exists to close.
    if (advertised !== previousSlug) {
      await releaseKeys(container, workspaceId, [advertised]);
    }
    const exchange = {
      slug: reservation.slug,
      operationId: reservation.operationId,
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
  } else {
    // No successor to hand either key to, so the standalone teardown
    // frees both.
    await releaseKeys(container, workspaceId, [previousSlug, advertised]);
  }

  await projectWorkspaceDirectory(
    container,
    "[changeWorkspaceSlug] directory projection",
    saved,
  );

  return { workspaceId, slug: nextSlug, previousSlug };
}
