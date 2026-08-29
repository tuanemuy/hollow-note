import { BusinessRuleError } from "@repo/core/domain/error";
import { UserId } from "@repo/core/domain/identity/valueObject";
import { WorkspaceErrorCode } from "@repo/core/domain/workspace/errorCode";
import { WorkspaceAuthorization } from "@repo/core/domain/workspace/services/workspaceAuthorization";
import { WorkspaceId } from "@repo/core/domain/workspace/valueObject";
import { ConflictError, ValidationError } from "../errors";
import { ScopeKey } from "../scope";
import type { ServiceArgs } from "../types";
import { resolveAdvertisedSlug } from "./changeWorkspaceSlug";
import { ensureActorCan } from "./membershipMutation";
import {
  resolveWorkspaceAccess,
  workspaceNotFound,
} from "./resolveWorkspaceAccess";
import { scheduleLocalTurn } from "./workspaceDeletion";

export type DeleteWorkspaceInput = Readonly<{
  workspaceId: string;
  userId: string;
  confirmationName: string;
}>;

/**
 * The request path's whole answer: the deletion continues on the worker
 * plane, and the caller follows the workspace disappearing rather than
 * this response.
 */
export type WorkspaceDeletionAcceptedView = Readonly<{
  operationId: string;
  status: "accepted";
}>;

const confirmationMismatch = (): ValidationError =>
  new ValidationError(
    "CONFIRMATION_MISMATCH",
    "The confirmation name does not match the workspace",
  );

/**
 * Accepts a workspace deletion (UC-workspace-007,
 * spec/usecases/workspace.md#deleteworkspace, WS-10).
 *
 * The request path stops at "accepted" (手順 3): one workspace-local
 * transaction confirms the name, refuses a staged note move, flips the
 * scope to `deleting` under a fresh operation id, and stores the first
 * `workspace.deletionLocalContinued` turn. Those land together, which is
 * what makes "the scope is closed" and "something is driving the cleanup"
 * inseparable — and why accepted is only returned after that commit.
 *
 * Everything after is a continuation on the scope plane
 * (`application/workspace/workspaceDeletion.ts`): manifest build, local
 * edge deletion, the Workspace row and `workspace.deleted`, then global
 * cleanup and the ack compaction that ends in `markCompleted`.
 *
 * Ahead of that commit the request fixes the two candidate keys the
 * cleanup will free, and refuses with `WORKSPACE_DIRECTORY_UNAVAILABLE`
 * while the directory cannot name the second one: accepting is what
 * makes this the last caller able to free either
 * (`resolveAdvertisedSlug`), so a deletion is not opened blind.
 *
 * Re-requesting is safe: a scope already `deleting` answers with the
 * operation that owns it and stores nothing, so a double submit joins the
 * running deletion instead of opening a second one. Its driver is the task
 * row the first request armed, which no turn removes until the phase it
 * belongs to is finished.
 *
 * One step of 手順 4 is **absent in this slice**: the forced termination of
 * the workspace's unfinished jobs, collected 100 at a time through
 * `JobRepository.listActiveByScope`. The Job aggregate does not exist yet
 * (Issue #5), so there is no repository to sweep and no `Job.cancel` to
 * apply; the gap is recorded rather than papered over, the same way
 * `application/cleanup/participants.ts` records it for account deletion.
 * When the Job slice lands, the sweep belongs in the local turns below —
 * ahead of the manifest build, so no job outlives the scope it ran in.
 */
export async function deleteWorkspace({
  container,
  input,
}: ServiceArgs<DeleteWorkspaceInput>): Promise<WorkspaceDeletionAcceptedView> {
  const access = await resolveWorkspaceAccess({
    container,
    input: { workspaceId: input.workspaceId, userId: input.userId },
  });
  if (access.role === null) {
    throw new BusinessRuleError(
      WorkspaceErrorCode.InsufficientRole,
      "Only a member can delete the workspace",
    );
  }
  WorkspaceAuthorization.ensureCan(access.role, "deleteWorkspace");

  const workspaceId = WorkspaceId.create(input.workspaceId);
  const userId = UserId.create(input.userId);
  const scope = ScopeKey.workspace(workspaceId);
  const operationId = container.idGenerator.next();
  const now = container.clock.now();
  // Read while the directory row still exists: global cleanup tombstones
  // it before it frees the keys, so this is the last point at which the
  // advertised candidate can be seen at all. A shard that cannot answer
  // is therefore refused rather than folded to "no candidate" — the
  // deletion would otherwise be accepted carrying one candidate, and an
  // `active` reservation the deletion misses has no expiry and no later
  // caller (`resolveAdvertisedSlug`). Refusing costs the requester a
  // retry and leaves the scope open, which is what keeps the repair
  // paths (a profile save re-sends the snapshot) reachable.
  const advertised = await resolveAdvertisedSlug(container, workspaceId, null);
  if (!advertised.known) {
    throw new ConflictError(
      "WORKSPACE_DIRECTORY_UNAVAILABLE",
      `The workspace directory cannot answer for ${workspaceId} yet`,
    );
  }

  return container.scopeUnitOfWorkProvider.run<WorkspaceDeletionAcceptedView>(
    scope,
    async (ctx) => {
      await ctx.cleanupAdmission.assertWritable();
      await ctx.cleanupAdmission.assertActorWritable(userId);
      await ensureActorCan(ctx, workspaceId, userId, "deleteWorkspace");

      const versioned = await ctx.workspaceRepository.findById(workspaceId);
      if (versioned === null) {
        throw workspaceNotFound();
      }
      const workspace = versioned.entity;
      if (input.confirmationName.trim() !== workspace.name) {
        throw confirmationMismatch();
      }
      if (workspace.lifecycle.state === "deleting") {
        return {
          operationId: workspace.lifecycle.operationId,
          status: "accepted",
        };
      }

      // Retiring the source of a move whose target is already staged
      // would strand the staged copy, so the deletion loses to the move
      // rather than the other way round (`hasActiveMove`).
      if (await ctx.workspaceOperationLockStore.hasActiveMove()) {
        throw new ConflictError(
          "WORKSPACE_MOVE_IN_PROGRESS",
          `A staged note move is in flight in workspace ${workspaceId}`,
        );
      }

      await ctx.workspaceOperationLockStore.beginDeletion({
        workspaceId,
        operationId,
        expectedWorkspaceVersion: versioned.expectedVersion,
      });
      await scheduleLocalTurn(
        ctx,
        {
          operationId,
          phase: "memberships",
          cursor: null,
          slug: workspace.slug,
          advertisedSlug: advertised.slug,
        },
        now,
      );
      return { operationId, status: "accepted" };
    },
  );
}
