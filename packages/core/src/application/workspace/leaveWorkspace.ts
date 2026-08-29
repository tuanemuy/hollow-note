import { UserId } from "@repo/core/domain/identity/valueObject";
import { WorkspaceEvents } from "@repo/core/domain/workspace/events";
import { MembershipPolicy } from "@repo/core/domain/workspace/services/membershipPolicy";
import { WorkspaceId } from "@repo/core/domain/workspace/valueObject";
import { NotFoundError } from "../errors";
import { ScopeKey } from "../scope";
import type { ServiceArgs } from "../types";
import { ensureMembershipMutable } from "./membershipMutation";

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
 * Leaving does not delete the member's notes, and rejoining takes a fresh
 * invitation — the removal here leaves no route behind.
 *
 * The job termination and the directory-edge teardown this flow shares
 * with `removeMember` are absent in this slice for the reasons recorded
 * there and in `./membershipMutation`.
 */
export async function leaveWorkspace({
  container,
  input,
}: ServiceArgs<LeaveWorkspaceInput>): Promise<void> {
  const workspaceId = WorkspaceId.create(input.workspaceId);
  const userId = UserId.create(input.userId);
  const now = container.clock.now();

  await container.scopeUnitOfWorkProvider.run(
    ScopeKey.workspace(workspaceId),
    async (ctx) => {
      await ctx.cleanupAdmission.assertWritable();
      await ctx.cleanupAdmission.assertActorWritable(userId);

      const membership = await ctx.membershipRepository.findByWorkspaceAndUser(
        workspaceId,
        userId,
      );
      if (membership === null) {
        throw new NotFoundError("MEMBERSHIP_NOT_FOUND", "Membership not found");
      }

      await ensureMembershipMutable(ctx, userId);

      const ownerCount = await ctx.membershipRepository.countByRole(
        workspaceId,
        "owner",
      );
      MembershipPolicy.ensureOwnerRemains(ownerCount, membership.entity, null);

      await ctx.membershipRepository.delete(
        membership.entity.id,
        membership.expectedVersion,
      );
      ctx.collectEvents([
        WorkspaceEvents.membershipRemoved(workspaceId, userId, now),
      ]);
    },
  );
}
