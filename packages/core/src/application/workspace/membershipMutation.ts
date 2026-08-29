import { BusinessRuleError } from "@repo/core/domain/error";
import type { UserId } from "@repo/core/domain/identity/valueObject";
import { WorkspaceErrorCode } from "@repo/core/domain/workspace/errorCode";
import type { Membership } from "@repo/core/domain/workspace/membership";
import { MembershipPolicy } from "@repo/core/domain/workspace/services/membershipPolicy";
import { WorkspaceAuthorization } from "@repo/core/domain/workspace/services/workspaceAuthorization";
import type { WorkspaceId } from "@repo/core/domain/workspace/valueObject";
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
 * Refuses a membership mutation the scope no longer admits, or one that
 * would invalidate a decision another in-flight operation already took
 * about the same user.
 *
 * The scope-wide barrier comes first and is the coarsest of the three: a
 * workspace that has accepted a deletion takes no further membership of
 * any kind, so a member added or demoted behind the manifest cursor
 * cannot outlive the scope (`WorkspaceOperationLockStore.assertWritable`,
 * spec/usecases/workspace.md#deleteworkspace 手順 3).
 *
 * All three reads happen inside the caller's unit of work, so the answer
 * and the write it admits share one transaction. None of the locks lapses
 * on a clock reading — an account deletion mid-recovery still answers
 * true, a staged move keeps its lock until the move settles or aborts,
 * and a deletion never reopens — so a membership mutation can never
 * decide on its own that one has gone stale.
 */
export async function ensureMembershipMutable(
  ctx: ScopeUnitOfWorkContext,
  userId: UserId,
): Promise<void> {
  await ctx.workspaceOperationLockStore.assertWritable();
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

/**
 * Everything that has to hold before a membership is torn down
 * (`removeMember` 手順 3–4 / `leaveWorkspace` 手順 2).
 *
 * Both removals run it twice: once before the global edge is announced
 * `removing`, and once inside the transaction that deletes the row.
 * Neither position alone is enough — nothing walks an edge back from
 * `removing`, so a refusal raised only inside the transaction would hide
 * the workspace from a member who still holds it, while a check made only
 * before it could be invalidated by a concurrent role change.
 */
export async function ensureRemovable(
  ctx: ScopeUnitOfWorkContext,
  target: Membership,
): Promise<void> {
  await ensureMembershipMutable(ctx, target.userId);
  const ownerCount = await ctx.membershipRepository.countByRole(
    target.workspaceId,
    "owner",
  );
  MembershipPolicy.ensureOwnerRemains(ownerCount, target, null);
}

/**
 * Drops the global directory edge once the removal's residue is settled
 * (`removeMember` 手順 5 / `leaveWorkspace` 手順 4).
 *
 * Called straight after the local commit because this slice leaves no
 * residue behind: the Job aggregate and the BackupRecord the spec waits
 * for do not exist yet, so the acknowledgement the deletion waits on is
 * already given. When they land, this call moves behind their cleanup.
 *
 * A failure is logged, not raised. The membership is already gone, so the
 * caller has nothing to retry — a re-run would answer `MEMBERSHIP_NOT_FOUND`
 * — and an edge left `removing` is absent from the member's list anyway,
 * which is the outcome the removal wanted.
 */
export async function settleRemovalEdge(
  container: RequestContainer,
  label: string,
  userId: UserId,
  workspaceId: WorkspaceId,
): Promise<void> {
  try {
    await container.membershipDirectoryReservationStore.completeRemoval(
      userId,
      workspaceId,
    );
  } catch (cause) {
    container.logger.error(`${label} directory edge removal failed`, { cause });
  }
}
