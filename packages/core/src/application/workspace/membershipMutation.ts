import { BusinessRuleError } from "@repo/core/domain/error";
import { UserId } from "@repo/core/domain/identity/valueObject";
import { WorkspaceErrorCode } from "@repo/core/domain/workspace/errorCode";
import type { Membership } from "@repo/core/domain/workspace/membership";
import { MembershipPolicy } from "@repo/core/domain/workspace/services/membershipPolicy";
import {
  type WorkspaceAction,
  WorkspaceAuthorization,
} from "@repo/core/domain/workspace/services/workspaceAuthorization";
import type { WorkspaceId } from "@repo/core/domain/workspace/valueObject";
import type { RequestContainer, WorkerContainer } from "../di/types";
import {
  ConflictError,
  isConflictError,
  isNotFoundError,
  SystemError,
  SystemErrorCode,
} from "../errors";
import type { ScopeUnitOfWorkContext } from "../execution/unitOfWork";
import {
  type ScopeTaskPayload,
  ScopeTaskPriority,
} from "../ports/scopeTaskScheduler";
import { ScopeKey } from "../scope";
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
 * Re-decides the actor's permission **inside** the transaction that is
 * about to write (spec/usecases/workspace.md 冒頭: the local permission
 * check taken immediately before a mutation is what makes a lagging
 * `membership_directory` projection a display gap rather than a
 * privilege).
 *
 * Every workspace write also resolves the actor outside the transaction,
 * which is what answers a request with no permission before any global
 * reservation is taken. That decision is not enough on its own: the
 * Workspace's own version does not move when a Membership changes, so an
 * owner demoted or removed while a request is in flight would otherwise
 * land a write with a role they no longer hold.
 *
 * A non-member is `InsufficientRole` rather than a not-found, for the
 * reason {@link requireManageMembers} gives.
 *
 * Where in the transaction it is called changes no outcome — nothing may
 * be written before it — only which refusal is reported when more than
 * one applies. The two membership mutations therefore call it **after**
 * the rules that belong to the target (`ensureNotSelfRemoval`,
 * `ensureRemovable`): "this workspace would be left without an owner" is
 * true of the workspace whoever is asking, and answering it first is what
 * keeps that refusal reachable at all, since an actor who still holds
 * `manageMembers` can never be the last owner of the same workspace.
 */
export async function ensureActorCan(
  ctx: ScopeUnitOfWorkContext,
  workspaceId: WorkspaceId,
  actorUserId: UserId,
  action: WorkspaceAction,
): Promise<void> {
  const membership = await ctx.membershipRepository.findByWorkspaceAndUser(
    workspaceId,
    actorUserId,
  );
  if (membership === null) {
    throw new BusinessRuleError(
      WorkspaceErrorCode.InsufficientRole,
      `User ${actorUserId} is not a member of workspace ${workspaceId}`,
    );
  }
  WorkspaceAuthorization.ensureCan(membership.entity.role, action);
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
 * Neither position alone is enough — a check made only before the
 * announcement could be invalidated by a concurrent role change, and one
 * made only inside the transaction would let a refusal arrive after the
 * workspace already left the member's list.
 *
 * The second evaluation can still refuse: two concurrent removals of two
 * owners both pass the first, and only one may pass the second. That is
 * what {@link restoreRemovalEdge} exists for — the announcement is taken
 * back rather than left standing over a membership that survived.
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
 * Takes back the `removing` announcement when the transaction that was to
 * delete the membership refused it (`removeMember` / `leaveWorkspace`).
 *
 * The refusal is terminal for this attempt — the last-owner rule, the
 * deletion barrier and a lost role are not conditions a retry clears — so
 * leaving the edge announced would hide the workspace from a member who
 * still holds it, with no call able to give it back.
 *
 * A membership that is **gone** is the one refusal that must not be
 * compensated: a concurrent removal of the same membership landed, and
 * putting its edge back would resurrect the workspace in the list of
 * someone who is no longer a member. That edge belongs to the removal
 * that won, which drops it on its own.
 *
 * The original error is the one the caller must see, so a failing restore
 * is logged and swallowed; the edge it could not move is still reachable
 * by repeating the removal.
 */
export async function restoreRemovalEdge(
  container: RequestContainer,
  label: string,
  cause: unknown,
  userId: UserId,
  workspaceId: WorkspaceId,
): Promise<void> {
  if (isNotFoundError(cause) && cause.code === "MEMBERSHIP_NOT_FOUND") {
    return;
  }
  try {
    await container.membershipDirectoryReservationStore.abandonRemoval(
      userId,
      workspaceId,
    );
  } catch (restoreError) {
    container.logger.error(`${label} directory edge restore failed`, {
      cause,
      restoreError,
    });
  }
}

/**
 * Re-issues the edge drop for a removal whose local commit landed and
 * whose `completeRemoval` did not (`leaveWorkspace`).
 *
 * Repeating the departure stops at `MEMBERSHIP_NOT_FOUND` because the
 * membership is exactly what is already gone, so the refusal is still the
 * caller's answer; settling the edge before it is re-raised is what makes
 * the retry worth issuing at all. It is a fast path in front of
 * {@link MEMBERSHIP_REMOVAL_EDGE_TASK_KIND}, not the only owner of the
 * obligation.
 *
 * Only that refusal drives it: any other means the membership still
 * exists and the removal has to run properly.
 */
export async function settleStrandedRemovalEdge(
  container: RequestContainer,
  label: string,
  cause: unknown,
  userId: UserId,
  workspaceId: WorkspaceId,
): Promise<void> {
  if (!isNotFoundError(cause) || cause.code !== "MEMBERSHIP_NOT_FOUND") {
    return;
  }
  await settleRemovalEdge(container, label, userId, workspaceId);
}

/**
 * Scope-task kind that carries a removal's edge drop
 * ([ADR 040](spec/adr/040-continuation-transport.md)).
 */
export const MEMBERSHIP_REMOVAL_EDGE_TASK_KIND =
  "workspace.membershipRemovalEdgeContinued";

/**
 * Row key of one removal's obligation. The directory edge carries no
 * operation id a removal could re-derive — it is keyed on the pair itself
 * (`MembershipDirectoryReservationStore.beginRemoval`) — so the pair is
 * also this continuation's deterministic id
 * ([ADR 041](spec/adr/041-deterministic-continuation-event-id.md)): two
 * concurrent removals of one membership arm the same row, and a turn
 * replayed after a lost response rewrites it instead of forking.
 */
const removalEdgeTaskId = (userId: UserId, workspaceId: WorkspaceId): string =>
  `${workspaceId}:${userId}`;

/**
 * Arms the durable driver of the edge drop, inside the transaction that
 * deletes the Membership (`removeMember` / `leaveWorkspace`).
 *
 * {@link settleRemovalEdge} runs immediately after that commit and
 * normally drops the edge before the request returns, but its failure is
 * not the caller's to retry: the membership is gone, so repeating the
 * removal answers `MEMBERSHIP_NOT_FOUND`. Left with no owner, the
 * `removing` edge would hold `(userId, workspaceId)` for good — neither a
 * re-invitation (`MEMBERSHIP_ALREADY_EXISTS`) nor another removal could
 * clear it, and the removed member could never rejoin.
 *
 * Storing the row in the removal's own transaction is what makes it
 * durable: an edge is announced `removing` only for a membership this
 * transaction deletes, so a committed row and a standing obligation are
 * the same fact.
 */
export const armRemovalEdgeSettlement = (
  ctx: ScopeUnitOfWorkContext,
  userId: UserId,
  workspaceId: WorkspaceId,
  now: Date,
): Promise<void> =>
  ctx.scopeTaskScheduler.schedule({
    kind: MEMBERSHIP_REMOVAL_EDGE_TASK_KIND,
    operationId: removalEdgeTaskId(userId, workspaceId),
    priority: ScopeTaskPriority.securityCleanup,
    dueAt: now,
    payload: { memberUserId: userId },
  });

/**
 * Drops the global directory edge once the removal's residue is settled
 * (`removeMember` 手順 5 / `leaveWorkspace` 手順 4), then settles the row
 * that stood behind it.
 *
 * Called straight after the local commit because this slice leaves no
 * residue behind: the Job aggregate and the BackupRecord the spec waits
 * for do not exist yet, so the acknowledgement the deletion waits on is
 * already given. When they land, this call moves behind their cleanup.
 *
 * A failure is logged, not raised: the membership is already gone, so the
 * removal itself succeeded, and an edge left `removing` is absent from the
 * member's list anyway — the outcome the removal wanted. The row armed by
 * {@link armRemovalEdgeSettlement} is left standing in that case, which is
 * what carries the rest of the way; the row is settled only once the edge
 * is actually gone.
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
    return;
  }
  try {
    await clearRemovalEdgeTask(container, userId, workspaceId);
  } catch (cause) {
    container.logger.error(`${label} removal edge task settle failed`, {
      cause,
    });
  }
}

const clearRemovalEdgeTask = (
  container: Pick<RequestContainer, "scopeUnitOfWorkProvider">,
  userId: UserId,
  workspaceId: WorkspaceId,
): Promise<void> =>
  container.scopeUnitOfWorkProvider.run(
    ScopeKey.workspace(workspaceId),
    (ctx) =>
      ctx.scopeTaskScheduler.complete(
        MEMBERSHIP_REMOVAL_EDGE_TASK_KIND,
        removalEdgeTaskId(userId, workspaceId),
      ),
  );

const corruptTurn = (detail: string): SystemError =>
  new SystemError(
    SystemErrorCode.DataIntegrityError,
    `Membership removal edge continuation: ${detail}`,
  );

const readRemovalEdgeTurn = (
  scope: ScopeKey,
  payload: ScopeTaskPayload,
): Readonly<{ userId: UserId; workspaceId: WorkspaceId }> => {
  if (scope.type !== "workspace") {
    throw corruptTurn(`scope ${scope.type} owns no membership removal`);
  }
  const memberUserId = payload.memberUserId;
  if (typeof memberUserId !== "string" || memberUserId.length === 0) {
    throw corruptTurn("payload carries no memberUserId");
  }
  return {
    userId: UserId.create(memberUserId),
    workspaceId: scope.workspaceId,
  };
};

/**
 * Re-issues the edge drop from the scope plane's own driver, for a
 * removal whose local commit landed and whose `completeRemoval` did not
 * (`application/workers/scopeTaskRunner.ts`).
 *
 * Delivery is at-least-once, so the turn is written to converge from
 * every state the pair can be in by the time it runs. An edge already
 * gone succeeds — that is the redelivery of a turn that worked. An edge
 * a later join has re-claimed answers `ConflictError`, and that refusal is
 * the point rather than a fault: the pair now belongs to a membership this
 * removal never announced, so the row is settled instead of retried, and
 * the new member's edge is left alone.
 */
export async function continueRemovalEdgeSettlement(
  container: WorkerContainer,
  params: Readonly<{ scope: ScopeKey; payload: ScopeTaskPayload }>,
): Promise<void> {
  const { userId, workspaceId } = readRemovalEdgeTurn(
    params.scope,
    params.payload,
  );
  try {
    await container.membershipDirectoryReservationStore.completeRemoval(
      userId,
      workspaceId,
    );
  } catch (cause) {
    if (!isConflictError(cause)) {
      throw cause;
    }
    container.logger.warn(
      "[workspace] a later edge holds the removed pair; nothing to drop",
      { cause, userId, workspaceId },
    );
  }
  await clearRemovalEdgeTask(container, userId, workspaceId);
}
