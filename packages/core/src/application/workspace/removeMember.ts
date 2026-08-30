import type { Versioned } from "@repo/core/domain/common/transactionalRepository";
import { UserId } from "@repo/core/domain/identity/valueObject";
import { WorkspaceEvents } from "@repo/core/domain/workspace/events";
import type { Membership } from "@repo/core/domain/workspace/membership";
import { MembershipPolicy } from "@repo/core/domain/workspace/services/membershipPolicy";
import {
  MembershipId,
  WorkspaceId,
} from "@repo/core/domain/workspace/valueObject";
import { NotFoundError } from "../errors";
import type { ScopeUnitOfWorkContext } from "../execution/unitOfWork";
import { ScopeKey } from "../scope";
import type { ServiceArgs } from "../types";
import {
  armRemovalEdgeSettlement,
  ensureActorCan,
  ensureRemovable,
  requireManageMembers,
  restoreRemovalEdge,
  settleRemovalEdge,
} from "./membershipMutation";

export type RemoveMemberInput = Readonly<{
  workspaceId: string;
  actorUserId: string;
  membershipId: string;
}>;

/**
 * Removes a member from a workspace.
 *
 * Removing oneself is refused with its own code rather than allowed: the
 * departure path is `leaveWorkspace`, which asks nothing of
 * `manageMembers` and lets the last non-owner leave. The last-owner rule
 * is the same one `changeMemberRole` applies, read and enforced inside
 * the transaction that deletes the row.
 *
 * The global edge is announced `removing` between two scope transactions
 * — a read that proves the removal will be allowed, then the write that
 * performs it. The announcement takes the workspace out of the member's
 * list at once while account deletion and integration cleanup can still
 * reach this scope through the edge, and it happens outside both
 * transactions because the two planes never share a unit of work. Both
 * transactions run the same guards, so the second may still refuse what
 * the first allowed; the announcement is then taken back rather than left
 * standing over a membership that survived. The transaction that does
 * delete the membership arms the edge drop as a continuation of its own,
 * since nothing the caller can re-send would reach an edge left behind
 * (see `./membershipMutation`).
 *
 * Notes the removed member created stay with the workspace — they belong
 * to the workspace, not to their author — so nothing here touches them.
 *
 * One step of the flow is absent in this slice: the forced
 * termination of the member's jobs and the security cleanup of their job
 * and backup residue have no aggregates to act on yet (see
 * `./membershipMutation`).
 */
export async function removeMember({
  container,
  input,
}: ServiceArgs<RemoveMemberInput>): Promise<void> {
  const workspaceId = WorkspaceId.create(input.workspaceId);
  const actorUserId = UserId.create(input.actorUserId);
  const membershipId = MembershipId.create(input.membershipId);

  await requireManageMembers(container, {
    workspaceId: input.workspaceId,
    actorUserId: input.actorUserId,
  });

  const scope = ScopeKey.workspace(workspaceId);
  const now = container.clock.now();
  const target = (ctx: ScopeUnitOfWorkContext) =>
    requireRemovableTarget(ctx, { workspaceId, membershipId, actorUserId });

  const memberUserId = await container.scopeUnitOfWorkProvider.run(
    scope,
    async (ctx) => {
      await ctx.cleanupAdmission.assertWritable();
      await ctx.cleanupAdmission.assertActorWritable(actorUserId);
      const found = await target(ctx);
      await ensureActorCan(ctx, workspaceId, actorUserId, "manageMembers");
      return found.entity.userId;
    },
  );

  await container.membershipDirectoryReservationStore.beginRemoval(
    memberUserId,
    workspaceId,
  );

  try {
    await container.scopeUnitOfWorkProvider.run(scope, async (ctx) => {
      await ctx.cleanupAdmission.assertWritable();
      await ctx.cleanupAdmission.assertActorWritable(actorUserId);

      const removed = await target(ctx);
      await ensureActorCan(ctx, workspaceId, actorUserId, "manageMembers");
      await ctx.membershipRepository.delete(
        removed.entity.id,
        removed.expectedVersion,
      );
      await armRemovalEdgeSettlement(ctx, memberUserId, workspaceId, now);
      ctx.collectEvents([
        WorkspaceEvents.membershipRemoved(
          workspaceId,
          removed.entity.userId,
          now,
        ),
      ]);
    });
  } catch (error) {
    await restoreRemovalEdge(
      container,
      "[removeMember]",
      error,
      memberUserId,
      workspaceId,
    );
    throw error;
  }

  await settleRemovalEdge(
    container,
    "[removeMember]",
    memberUserId,
    workspaceId,
  );
}

/** The target of the removal, once it is known to be allowed. */
async function requireRemovableTarget(
  ctx: ScopeUnitOfWorkContext,
  params: Readonly<{
    workspaceId: WorkspaceId;
    membershipId: MembershipId;
    actorUserId: UserId;
  }>,
): Promise<Versioned<Membership>> {
  const target = await ctx.membershipRepository.findById(params.membershipId);
  if (target === null || target.entity.workspaceId !== params.workspaceId) {
    throw new NotFoundError("MEMBERSHIP_NOT_FOUND", "Membership not found");
  }
  MembershipPolicy.ensureNotSelfRemoval(params.actorUserId, target.entity);
  await ensureRemovable(ctx, target.entity);
  return target;
}
