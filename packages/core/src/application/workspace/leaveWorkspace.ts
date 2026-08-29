import type { Versioned } from "@repo/core/domain/common/transactionalRepository";
import { UserId } from "@repo/core/domain/identity/valueObject";
import { WorkspaceEvents } from "@repo/core/domain/workspace/events";
import type { Membership } from "@repo/core/domain/workspace/membership";
import { WorkspaceId } from "@repo/core/domain/workspace/valueObject";
import { NotFoundError } from "../errors";
import type { ScopeUnitOfWorkContext } from "../execution/unitOfWork";
import { ScopeKey } from "../scope";
import type { ServiceArgs } from "../types";
import {
  armRemovalEdgeSettlement,
  ensureRemovable,
  restoreRemovalEdge,
  settleRemovalEdge,
  settleStrandedRemovalEdge,
} from "./membershipMutation";

export type LeaveWorkspaceInput = Readonly<{
  workspaceId: string;
  userId: string;
}>;

/**
 * Lets a member leave a workspace on their own (UC-workspace-018,
 * spec/usecases/workspace.md#leaveworkspace).
 *
 * No role is required — leaving is not an act of management — so the
 * membership lookup is both the authorization and the target: a
 * non-member gets `MEMBERSHIP_NOT_FOUND` and there is nothing to refuse
 * separately. The last owner is still held back, since a workspace
 * without an owner could never be managed again; that member has to hand
 * ownership over first.
 *
 * The global edge is announced `removing` between the read that proves
 * the departure is allowed and the write that performs it, and taken back
 * when the write refuses after all, for the reasons `removeMember`
 * records.
 *
 * Leaving does not delete the member's notes, and rejoining takes a fresh
 * invitation — the removal here leaves no route behind.
 *
 * Leaving again settles the edge of a departure whose global drop was
 * lost, ahead of the continuation the departing transaction armed for the
 * same obligation: the membership is gone by then, so the request answers
 * `MEMBERSHIP_NOT_FOUND` either way, and the edge that would otherwise
 * hold the `(userId, workspaceId)` pair against a future join is dropped
 * before the refusal is raised.
 *
 * The job termination this flow shares with `removeMember` is absent in
 * this slice for the reason recorded in `./membershipMutation`.
 */
export async function leaveWorkspace({
  container,
  input,
}: ServiceArgs<LeaveWorkspaceInput>): Promise<void> {
  const workspaceId = WorkspaceId.create(input.workspaceId);
  const userId = UserId.create(input.userId);
  const scope = ScopeKey.workspace(workspaceId);
  const now = container.clock.now();
  const target = (ctx: ScopeUnitOfWorkContext) =>
    requireRemovableMembership(ctx, workspaceId, userId);

  try {
    await container.scopeUnitOfWorkProvider.run(scope, async (ctx) => {
      await ctx.cleanupAdmission.assertWritable();
      await ctx.cleanupAdmission.assertActorWritable(userId);
      await target(ctx);
    });
  } catch (error) {
    await settleStrandedRemovalEdge(
      container,
      "[leaveWorkspace]",
      error,
      userId,
      workspaceId,
    );
    throw error;
  }

  await container.membershipDirectoryReservationStore.beginRemoval(
    userId,
    workspaceId,
  );

  try {
    await container.scopeUnitOfWorkProvider.run(scope, async (ctx) => {
      await ctx.cleanupAdmission.assertWritable();
      await ctx.cleanupAdmission.assertActorWritable(userId);

      const membership = await target(ctx);
      await ctx.membershipRepository.delete(
        membership.entity.id,
        membership.expectedVersion,
      );
      await armRemovalEdgeSettlement(ctx, userId, workspaceId, now);
      ctx.collectEvents([
        WorkspaceEvents.membershipRemoved(workspaceId, userId, now),
      ]);
    });
  } catch (error) {
    await restoreRemovalEdge(
      container,
      "[leaveWorkspace]",
      error,
      userId,
      workspaceId,
    );
    throw error;
  }

  await settleRemovalEdge(container, "[leaveWorkspace]", userId, workspaceId);
}

/** 手順 1〜2: the leaver's membership, once it is known to be removable. */
async function requireRemovableMembership(
  ctx: ScopeUnitOfWorkContext,
  workspaceId: WorkspaceId,
  userId: UserId,
): Promise<Versioned<Membership>> {
  const membership = await ctx.membershipRepository.findByWorkspaceAndUser(
    workspaceId,
    userId,
  );
  if (membership === null) {
    throw new NotFoundError("MEMBERSHIP_NOT_FOUND", "Membership not found");
  }
  await ensureRemovable(ctx, membership.entity);
  return membership;
}
