import { BusinessRuleError } from "@repo/core/domain/error";
import type { UserId } from "@repo/core/domain/identity/valueObject";
import { WorkspaceErrorCode } from "@repo/core/domain/workspace/errorCode";
import { WorkspaceAuthorization } from "@repo/core/domain/workspace/services/workspaceAuthorization";
import type { RequestContainer } from "../di/types";
import { ConflictError } from "../errors";
import type { ScopeUnitOfWorkContext } from "../execution/unitOfWork";
import { resolveWorkspaceAccess } from "./resolveWorkspaceAccess";

/**
 * Guards the three membership mutations share
 * (spec/usecases/workspace.md `changeMemberRole` / `removeMember` /
 * `leaveWorkspace`).
 *
 * One step of those flows is **absent in this slice**: the forced
 * termination of the target's unfinished jobs, swept 100 at a time and
 * continued through `job.terminationContinued`. The Job aggregate does
 * not exist yet, so there is no `JobRepository` to sweep, no `Job.cancel`
 * to apply, and no `continueForcedTermination` to hand a full page to.
 * The gap is recorded rather than papered over, the same way
 * `application/cleanup/participants.ts` records it for account deletion
 * (`job: absent("The Job aggregate does not exist", "#5")`).
 *
 * Emitting the continuation anyway would be worse than omitting it:
 * `continuationSubscribers` is exhaustive over the continuation types, so
 * an unsubscribed continuation is a chain that stops rather than an event
 * that is merely ignored (`application/workers/subscribers.ts`). When the
 * Job slice lands, the sweep belongs **inside** each usecase's existing
 * unit of work — no transaction may drop a role, or remove a membership,
 * while leaving that member's jobs running.
 */

/**
 * Resolves the actor's role and refuses anyone who may not manage
 * members. A non-member is `InsufficientRole` rather than a not-found:
 * the workspace itself was already proven to exist by the resolution, so
 * hiding the distinction here would only mislead a member who lost their
 * role mid-session.
 */
export async function requireManageMembers(
  container: RequestContainer,
  input: Readonly<{ workspaceId: string; actorUserId: string }>,
): Promise<void> {
  const access = await resolveWorkspaceAccess({
    container,
    input: { workspaceId: input.workspaceId, userId: input.actorUserId },
  });
  if (access.role === null) {
    throw new BusinessRuleError(
      WorkspaceErrorCode.InsufficientRole,
      "Only a member can manage the workspace members",
    );
  }
  WorkspaceAuthorization.ensureCan(access.role, "manageMembers");
}

/**
 * Refuses a membership mutation that would invalidate a decision another
 * in-flight operation already took about the same user.
 *
 * Both reads happen inside the caller's unit of work, so the answer and
 * the write it admits share one transaction. Neither lock lapses on a
 * clock reading — an account deletion mid-recovery still answers true,
 * and a staged move keeps its lock until the move settles or aborts — so
 * a membership mutation can never decide on its own that one has gone
 * stale (`MembershipRemovalPreparationStore` / `WorkspaceOperationLockStore`).
 */
export async function ensureMembershipMutable(
  ctx: ScopeUnitOfWorkContext,
  userId: UserId,
): Promise<void> {
  if (await ctx.membershipRemovalPreparationStore.hasConflict(userId)) {
    throw new ConflictError(
      "ACCOUNT_DELETING",
      `A membership removal preparation holds the membership of ${userId}`,
    );
  }
  if (await ctx.workspaceOperationLockStore.hasMoveConflict(userId)) {
    throw new ConflictError(
      "WORKSPACE_MOVE_IN_PROGRESS",
      `A staged note move pins the membership of ${userId}`,
    );
  }
}
