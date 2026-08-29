import { UserId } from "@repo/core/domain/identity/valueObject";
import { WorkspaceEvents } from "@repo/core/domain/workspace/events";
import { MembershipPolicy } from "@repo/core/domain/workspace/services/membershipPolicy";
import {
  MembershipId,
  WorkspaceId,
} from "@repo/core/domain/workspace/valueObject";
import { NotFoundError } from "../errors";
import { ScopeKey } from "../scope";
import type { ServiceArgs } from "../types";
import {
  ensureMembershipMutable,
  requireManageMembers,
} from "./membershipMutation";

export type RemoveMemberInput = Readonly<{
  workspaceId: string;
  actorUserId: string;
  membershipId: string;
}>;

/**
 * Removes a member from a workspace (UC-workspace-017,
 * spec/usecases/workspace.md#removemember).
 *
 * Removing oneself is refused with its own code rather than allowed: the
 * departure path is `leaveWorkspace`, which asks nothing of
 * `manageMembers` and lets the last non-owner leave. The last-owner rule
 * is the same one `changeMemberRole` applies, read and enforced inside
 * the transaction that deletes the row.
 *
 * Notes the removed member created stay with the workspace — they belong
 * to the workspace, not to their author — so nothing here touches them.
 *
 * Two steps of the spec'd flow are absent in this slice. The forced
 * termination of the member's jobs and the security cleanup of their job
 * and backup residue have no aggregates to act on yet (see
 * `./membershipMutation`); and marking the global directory edge
 * `removing` before the local commit, then deleting it once that cleanup
 * acknowledges, has no port to call — `MembershipDirectoryReservationStore`
 * exposes only the join saga and the account-deletion transitions
 * (spec/domains/workspace.md#ポート). Until both land, the edge is
 * reconciled by the same source-version rule that already keeps a stale
 * role from resurrecting, and a lingering edge grants nothing: every
 * permission decision re-reads `Membership` in this scope, which this
 * transaction has already removed.
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

  const now = container.clock.now();

  await container.scopeUnitOfWorkProvider.run(
    ScopeKey.workspace(workspaceId),
    async (ctx) => {
      await ctx.cleanupAdmission.assertWritable();
      await ctx.cleanupAdmission.assertActorWritable(actorUserId);

      const target = await ctx.membershipRepository.findById(membershipId);
      if (target === null || target.entity.workspaceId !== workspaceId) {
        throw new NotFoundError("MEMBERSHIP_NOT_FOUND", "Membership not found");
      }

      MembershipPolicy.ensureNotSelfRemoval(actorUserId, target.entity);
      await ensureMembershipMutable(ctx, target.entity.userId);

      const ownerCount = await ctx.membershipRepository.countByRole(
        workspaceId,
        "owner",
      );
      MembershipPolicy.ensureOwnerRemains(ownerCount, target.entity, null);

      await ctx.membershipRepository.delete(
        target.entity.id,
        target.expectedVersion,
      );
      ctx.collectEvents([
        WorkspaceEvents.membershipRemoved(
          workspaceId,
          target.entity.userId,
          now,
        ),
      ]);
    },
  );
}
