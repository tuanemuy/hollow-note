import { UserId } from "@repo/core/domain/identity/valueObject";
import { Membership } from "@repo/core/domain/workspace/membership";
import { MembershipPolicy } from "@repo/core/domain/workspace/services/membershipPolicy";
import {
  MembershipId,
  WorkspaceId,
  WorkspaceRole,
} from "@repo/core/domain/workspace/valueObject";
import { NotFoundError } from "../errors";
import { ScopeKey } from "../scope";
import type { ServiceArgs } from "../types";
import {
  ensureActorCan,
  ensureMembershipMutable,
  requireManageMembers,
} from "./membershipMutation";
import type { ChangedMemberRoleView } from "./view";

export type ChangeMemberRoleInput = Readonly<{
  workspaceId: string;
  actorUserId: string;
  membershipId: string;
  role: string;
}>;

const membershipNotFound = (): NotFoundError =>
  new NotFoundError("MEMBERSHIP_NOT_FOUND", "Membership not found");

/**
 * Changes one member's role.
 *
 * The owner count, the last-owner rule and the write all live in one
 * scope transaction: a count read outside it can go stale between the
 * check and the save and let the final owner be demoted. `MembershipPolicy`
 * owns both refusals — self-change and last-owner — so the rule has a
 * single statement and this usecase only supplies the count it judges.
 *
 * The actor's own permission is decided twice — once before the
 * transaction, so a request with no role is refused at once, and once
 * inside it, so an owner demoted while this request was in flight cannot
 * land a change with a role they no longer hold (`ensureActorCan`).
 *
 * A membership id from another workspace resolves to not-found rather
 * than a permission error: the repository is bound to this scope, so a
 * foreign id simply matches nothing.
 *
 * The global directory edge is not written here. The role it projects is
 * updated out of band by the `workspace.membership.roleChanged`
 * subscriber (`./membershipRoleProjection`), which is what keeps the two
 * planes out of one unit of work; until it runs, the workspace switcher
 * shows the previous role while every decision still re-reads
 * `Membership`.
 *
 * Naming the same role is a success with no write and no event, which is
 * what makes a double-submitted form harmless — and, once the Job slice
 * lands, what keeps it from cancelling jobs a member never lost the right
 * to run. See `./membershipMutation` for the termination step this slice
 * does not perform.
 */
export async function changeMemberRole({
  container,
  input,
}: ServiceArgs<ChangeMemberRoleInput>): Promise<ChangedMemberRoleView> {
  const workspaceId = WorkspaceId.create(input.workspaceId);
  const actorUserId = UserId.create(input.actorUserId);
  const membershipId = MembershipId.create(input.membershipId);

  await requireManageMembers(container, {
    workspaceId: input.workspaceId,
    actorUserId: input.actorUserId,
  });

  const nextRole = WorkspaceRole.create(input.role);
  const now = container.clock.now();

  return container.scopeUnitOfWorkProvider.run(
    ScopeKey.workspace(workspaceId),
    async (ctx) => {
      await ctx.cleanupAdmission.assertWritable();
      await ctx.cleanupAdmission.assertActorWritable(actorUserId);

      const target = await ctx.membershipRepository.findById(membershipId);
      if (target === null || target.entity.workspaceId !== workspaceId) {
        throw membershipNotFound();
      }

      MembershipPolicy.ensureNotSelfRoleChange(actorUserId, target.entity);
      await ensureMembershipMutable(ctx, target.entity.userId);

      const ownerCount = await ctx.membershipRepository.countByRole(
        workspaceId,
        "owner",
      );
      MembershipPolicy.ensureOwnerRemains(ownerCount, target.entity, nextRole);
      await ensureActorCan(ctx, workspaceId, actorUserId, "manageMembers");

      const changed = Membership.changeRole(target.entity, nextRole, now);
      if (changed.eventDrafts.length > 0) {
        await ctx.membershipRepository.save(
          changed.entity,
          target.expectedVersion,
        );
        ctx.collectEvents(changed.eventDrafts);
      }

      return { membershipId: changed.entity.id, role: changed.entity.role };
    },
  );
}
