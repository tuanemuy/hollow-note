import { UserId } from "@repo/core/domain/identity/valueObject";
import { Invitation } from "@repo/core/domain/workspace/invitation";
import { Membership } from "@repo/core/domain/workspace/membership";
import {
  type InvitationId,
  MembershipId,
  type WorkspaceId,
  type WorkspaceRole,
} from "@repo/core/domain/workspace/valueObject";
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
  if (!Invitation.isPending(stored.entity)) {
    throw invitationNotPending();
  }
  const role = stored.entity.role;
  const now = clock.now();

  const existing = await reader.membership.findByWorkspaceAndUser(
    workspaceId,
    userId,
  );
  if (existing !== null) {
    // The edge and the membership already exist, so the join saga has
    // nothing to do; only the invitation is settled, and the role the
    // member already holds wins over the one the link offered.
    await scopeUnitOfWorkProvider.run(scope, async (ctx) => {
      await ctx.cleanupAdmission.assertWritable();
      await ctx.cleanupAdmission.assertActorWritable(userId);
      await ctx.workspaceOperationLockStore.assertWritable();
      await acceptPending(ctx, invitationId, userId, now);
    });
    await retryOnce(logger, "[acceptInvitation] consume", () =>
      invitationRouteStore.consume({
        tokenHash,
        invitationId,
        operationId: idGenerator.next(),
      }),
    );
    return { workspaceId, role: existing.entity.role };
  }

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
 * Settles the invitation inside the caller's transaction. Re-read there
 * rather than carried in from the pre-checks, because the OCC token a
 * save consumes has to come from the transaction that saves.
 */
async function acceptPending(
  ctx: ScopeUnitOfWorkContext,
  invitationId: InvitationId,
  userId: UserId,
  now: Date,
): Promise<Readonly<{ workspaceId: WorkspaceId; role: WorkspaceRole }>> {
  const fresh = await ctx.invitationRepository.findById(invitationId);
  if (fresh === null) {
    throw invitationNotFound();
  }
  if (!Invitation.isPending(fresh.entity)) {
    throw invitationNotPending();
  }
  const accepted = Invitation.accept(fresh.entity, userId, now);
  await ctx.invitationRepository.save(accepted.entity, fresh.expectedVersion);
  ctx.collectEvents(accepted.eventDrafts);
  return {
    workspaceId: accepted.entity.workspaceId,
    role: accepted.entity.role,
  };
}
