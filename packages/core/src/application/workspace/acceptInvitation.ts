import { UserId } from "@repo/core/domain/identity/valueObject";
import { Invitation } from "@repo/core/domain/workspace/invitation";
import { Membership } from "@repo/core/domain/workspace/membership";
import {
  type InvitationId,
  MembershipId,
  type WorkspaceId,
  type WorkspaceRole,
} from "@repo/core/domain/workspace/valueObject";
import type { RequestContainer } from "../di/types";
import type { ScopeUnitOfWorkContext } from "../execution/unitOfWork";
import { ScopeKey } from "../scope";
import type { ServiceArgs } from "../types";
import {
  compensate,
  invitationNotFound,
  invitationNotPending,
  retryOnce,
} from "./invitation";
import { workspaceNotFound } from "./resolveWorkspaceAccess";
import type { AcceptedInvitationView } from "./view";

export type AcceptInvitationInput = Readonly<{
  token: string;
  userId: string;
}>;

/**
 * How long the membership edge stays claimed while the scope commits.
 * Only a recovery bound: an orphaned claim is reconciled against the
 * workspace-local Membership of the same operation once it lapses.
 */
const EDGE_RESERVATION_TTL_MS = 10 * 60 * 1000;

/**
 * Accepts an invitation and joins the workspace
 * (UC-workspace-012, spec/usecases/workspace.md#acceptinvitation).
 *
 * The link itself is the authorization, so the signed-in address need not
 * match the invited one (WS-04).
 *
 * Saga across two planes: `reserveAndClaimActivation` on the invitee's
 * UserId shard (which inserts the edge, checks the User is active, and
 * claims the activation in one transaction) → the workspace scope commit
 * of `Invitation.accept` + `Membership.create` → `activate` on the edge
 * and `consume` on the token route. The claim is what serializes joining
 * against account deletion — a deleting User leaves no edge at all — and
 * what makes two concurrent accepts of one invitation resolve to a single
 * membership: the loser gets `MEMBERSHIP_ALREADY_EXISTS` before any
 * workspace-local write. A failed commit abandons the edge and leaves the
 * invitation pending.
 *
 * Opening the link again is also the repair path for the two steps that
 * follow the commit. A caller who is already a member takes the settling
 * branch, which re-issues the edge activation and the token consume
 * idempotently — without it a lost activation left the member out of
 * their own workspace list for good, since the invitation is `accepted`
 * by then and nothing else drives the edge.
 */
export async function acceptInvitation({
  container,
  input,
}: ServiceArgs<AcceptInvitationInput>): Promise<AcceptedInvitationView> {
  const {
    clock,
    idGenerator,
    invitationRouteStore,
    logger,
    membershipDirectoryReservationStore,
    scopeUnitOfWorkProvider,
    secureTokenGenerator,
  } = container;

  const userId = UserId.create(input.userId);
  const tokenHash = secureTokenGenerator.hashOf(input.token);
  const target = await invitationRouteStore.resolveActive(tokenHash);
  if (target === null) {
    throw invitationNotFound();
  }
  const { workspaceId, invitationId } = target;
  const scope = ScopeKey.workspace(workspaceId);
  const reader = container.workspaceReaderFor(scope);

  const workspace = await reader.workspace.findById(workspaceId);
  if (workspace === null) {
    throw workspaceNotFound();
  }

  const stored = await reader.invitation.findByTokenHash(tokenHash);
  if (stored === null) {
    throw invitationNotFound();
  }
  const now = clock.now();

  const existing = await reader.membership.findByWorkspaceAndUser(
    workspaceId,
    userId,
  );
  if (existing !== null) {
    // The membership already exists, so the join saga has nothing left to
    // create; only the invitation is settled, and the role the member
    // already holds wins over the one the link offered.
    //
    // Answered before the invitation's status, which is what makes this
    // the re-entry for a join whose scope commit landed and whose global
    // steps did not: the invitation is `accepted` by then, and refusing on
    // that would leave the edge stranded with nothing able to settle it.
    await scopeUnitOfWorkProvider.run(scope, async (ctx) => {
      await ctx.cleanupAdmission.assertWritable();
      await ctx.cleanupAdmission.assertActorWritable(userId);
      await ctx.workspaceOperationLockStore.assertWritable();
      await acceptIfPending(ctx, invitationId, userId, now);
    });
    await settleStrandedEdge(container, userId, workspaceId);
    await retryOnce(logger, "[acceptInvitation] consume", () =>
      invitationRouteStore.consume({
        tokenHash,
        invitationId,
        operationId: idGenerator.next(),
      }),
    );
    return { workspaceId, role: existing.entity.role };
  }

  if (!Invitation.isPending(stored.entity)) {
    throw invitationNotPending();
  }
  const role = stored.entity.role;

  // Refused before the edge is claimed on the invitee's shard, and again
  // inside the commit below (spec/usecases/workspace.md#deleteworkspace).
  await reader.admission.assertWritable();

  const operationId = idGenerator.next();
  const membershipId = MembershipId.create(idGenerator.next());
  await membershipDirectoryReservationStore.reserveAndClaimActivation({
    operationId,
    userId,
    workspaceId,
    membershipId,
    role,
    expiresAt: new Date(now.getTime() + EDGE_RESERVATION_TTL_MS),
  });

  try {
    await scopeUnitOfWorkProvider.run(scope, async (ctx) => {
      await ctx.cleanupAdmission.assertWritable();
      await ctx.cleanupAdmission.assertActorWritable(userId);
      await ctx.workspaceOperationLockStore.assertWritable();
      const accepted = await acceptPending(ctx, invitationId, userId, now);
      const membership = Membership.create(
        { id: membershipId, workspaceId, userId, role: accepted.role },
        now,
      );
      await ctx.membershipRepository.insert(membership.entity);
      ctx.collectEvents(membership.eventDrafts);
    });
  } catch (error) {
    await compensate(logger, "[acceptInvitation] abandon edge", error, () =>
      membershipDirectoryReservationStore.abandon(operationId),
    );
    throw error;
  }

  await retryOnce(logger, "[acceptInvitation] activate edge", () =>
    membershipDirectoryReservationStore.activate(operationId),
  );
  await retryOnce(logger, "[acceptInvitation] consume", () =>
    invitationRouteStore.consume({ tokenHash, invitationId, operationId }),
  );

  return { workspaceId, role };
}

/**
 * Settles the invitation inside the caller's transaction, answering
 * `null` when it is no longer pending. Re-read there rather than carried
 * in from the pre-checks, because the OCC token a save consumes has to
 * come from the transaction that saves.
 *
 * Tolerating a settled invitation is what the re-entry of an existing
 * member needs: the attempt whose global steps were lost left the
 * invitation `accepted`, and this call has to reach past it.
 */
async function acceptIfPending(
  ctx: ScopeUnitOfWorkContext,
  invitationId: InvitationId,
  userId: UserId,
  now: Date,
): Promise<Readonly<{ workspaceId: WorkspaceId; role: WorkspaceRole }> | null> {
  const fresh = await ctx.invitationRepository.findById(invitationId);
  if (fresh === null) {
    throw invitationNotFound();
  }
  if (!Invitation.isPending(fresh.entity)) {
    return null;
  }
  const accepted = Invitation.accept(fresh.entity, userId, now);
  await ctx.invitationRepository.save(accepted.entity, fresh.expectedVersion);
  ctx.collectEvents(accepted.eventDrafts);
  return {
    workspaceId: accepted.entity.workspaceId,
    role: accepted.entity.role,
  };
}

/**
 * The join's form of the same step: a link whose invitation is no longer
 * pending cannot be redeemed into a new membership.
 */
async function acceptPending(
  ctx: ScopeUnitOfWorkContext,
  invitationId: InvitationId,
  userId: UserId,
  now: Date,
): Promise<Readonly<{ workspaceId: WorkspaceId; role: WorkspaceRole }>> {
  const accepted = await acceptIfPending(ctx, invitationId, userId, now);
  if (accepted === null) {
    throw invitationNotPending();
  }
  return accepted;
}

/**
 * How many of the shard's activating edges one re-entry looks through. A
 * user carries one per join still in flight, so the bound only keeps an
 * unbounded read out of a request path.
 */
const ACTIVATING_EDGE_SCAN_LIMIT = 100;

/**
 * Settles the edge of a join whose scope commit landed but whose
 * `activate` never did.
 *
 * That state has no other owner: the membership exists, so nothing
 * retries the join, while the edge stays `activating` and the workspace
 * stays out of the member's list. The edge's operation id belongs to the
 * attempt that reserved it and cannot be re-derived, so the shard's
 * activating edges are enumerated to find the one pointing at this
 * workspace. A join that settled leaves nothing to find, which is the
 * ordinary case.
 */
async function settleStrandedEdge(
  container: RequestContainer,
  userId: UserId,
  workspaceId: WorkspaceId,
): Promise<void> {
  const store = container.membershipDirectoryReservationStore;
  const edges = await store.listActivatingByUser(
    userId,
    ACTIVATING_EDGE_SCAN_LIMIT,
  );
  const stranded = edges.find((edge) => edge.workspaceId === workspaceId);
  if (stranded === undefined) {
    return;
  }
  await retryOnce(container.logger, "[acceptInvitation] activate edge", () =>
    store.activate(stranded.operationId),
  );
}
