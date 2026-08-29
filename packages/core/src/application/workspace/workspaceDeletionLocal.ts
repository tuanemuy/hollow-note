import { WorkspaceEvents } from "@repo/core/domain/workspace/events";
import {
  InvitationId,
  MembershipId,
  type WorkspaceId,
} from "@repo/core/domain/workspace/valueObject";
import type { WorkerContainer } from "../di/types";
import type { ScopeUnitOfWorkContext } from "../execution/unitOfWork";
import type { ScopeTaskPayload } from "../ports/scopeTaskScheduler";
import type { ScopeKey } from "../scope";
import {
  admitDeletionTurn,
  readLocalTurn,
  requireWorkspaceScope,
  scheduleGlobalTurn,
  scheduleLocalTurn,
  WORKSPACE_DELETION_LOCAL_TASK_KIND,
  WORKSPACE_DELETION_PAGE_LIMIT,
  type WorkspaceDeletionLocalTurn,
} from "./workspaceDeletion";

/**
 * The scope-local half of a workspace deletion
 * (spec/usecases/workspace.md#deleteworkspace 手順 5 / 6).
 *
 * Three phases run one page per turn, each landing its work, its cursor
 * and the task row of the next turn in a single transaction: fix the
 * Memberships, fix the Invitations and `markReady`, then delete the fixed
 * rows and acknowledge them. The last turn — the one that finds nothing
 * left pending — is the only one that touches the Workspace row itself,
 * and it hands over to global cleanup in the same transaction.
 *
 * Deleting the children and reading them back never share a transaction.
 * A bulk delete cannot carry a row image on the Cloudflare backend, so it
 * is staged opaquely and is invisible to a read issued in the same unit of
 * work; the "no children left" check therefore belongs to the *next* turn,
 * after the page that removed them committed. The same rule is why
 * `listLocalPending` is read once, at the head of a turn, rather than
 * again after `acknowledgeLocal`.
 *
 * Idempotency is per turn, not per chain: appending a page fixes nothing
 * new, `deleteByIds` skips ids that are already gone, `acknowledgeLocal`
 * keeps its first timestamp, and the Workspace is deleted only while its
 * row is still there — so a turn re-run after a lost response converges on
 * what it already did.
 */

/**
 * Advances one turn of the local half. The turn is fully described by the
 * task payload, so a re-claimed row repeats exactly the turn it named.
 */
export async function continueWorkspaceDeletionLocal(
  container: WorkerContainer,
  params: Readonly<{ scope: ScopeKey; payload: ScopeTaskPayload }>,
): Promise<void> {
  const workspaceId = requireWorkspaceScope(params.scope);
  const turn = readLocalTurn(params.payload);
  const now = container.clock.now();

  await container.scopeUnitOfWorkProvider.run(params.scope, async (ctx) => {
    if (
      !(await admitDeletionTurn(
        ctx,
        WORKSPACE_DELETION_LOCAL_TASK_KIND,
        turn.operationId,
      ))
    ) {
      return;
    }

    switch (turn.phase) {
      case "memberships": {
        const page =
          await ctx.workspaceDeletionManifestStore.appendMembershipPage(
            turn.operationId,
            turn.cursor === null ? null : MembershipId.create(turn.cursor),
            WORKSPACE_DELETION_PAGE_LIMIT,
          );
        await scheduleLocalTurn(
          ctx,
          page.next !== null
            ? { ...turn, phase: "memberships", cursor: page.next }
            : { ...turn, phase: "invitations", cursor: null },
          now,
        );
        return;
      }
      case "invitations": {
        const page =
          await ctx.workspaceDeletionManifestStore.appendInvitationPage(
            turn.operationId,
            turn.cursor === null ? null : InvitationId.create(turn.cursor),
            WORKSPACE_DELETION_PAGE_LIMIT,
          );
        if (page.next !== null) {
          await scheduleLocalTurn(
            ctx,
            { ...turn, phase: "invitations", cursor: page.next },
            now,
          );
          return;
        }
        await ctx.workspaceDeletionManifestStore.markReady(turn.operationId);
        await scheduleLocalTurn(
          ctx,
          { ...turn, phase: "localDelete", cursor: null },
          now,
        );
        return;
      }
      case "localDelete":
        await deleteLocalPage(ctx, { workspaceId, turn, now });
        return;
    }
  });
}

async function deleteLocalPage(
  ctx: ScopeUnitOfWorkContext,
  params: Readonly<{
    workspaceId: WorkspaceId;
    turn: WorkspaceDeletionLocalTurn;
    now: Date;
  }>,
): Promise<void> {
  const { turn } = params;
  const items = await ctx.workspaceDeletionManifestStore.listLocalPending(
    turn.operationId,
    WORKSPACE_DELETION_PAGE_LIMIT,
  );
  if (items.length === 0) {
    await retireWorkspace(ctx, params);
    return;
  }

  const membershipIds = items.flatMap((item) =>
    item.kind === "membership" ? [item.membershipId] : [],
  );
  const invitationIds = items.flatMap((item) =>
    item.kind === "invitation" ? [item.invitationId] : [],
  );
  if (membershipIds.length > 0) {
    await ctx.membershipRepository.deleteByIds(membershipIds);
  }
  if (invitationIds.length > 0) {
    await ctx.invitationRepository.deleteByIds(invitationIds);
  }
  // The acknowledgement shares this transaction with the deletes, so a
  // lost response leaves a state the next turn reads off the manifest
  // rather than off rows that may already be gone.
  await ctx.workspaceDeletionManifestStore.acknowledgeLocal(
    turn.operationId,
    items.map((item) => item.key),
  );
  await scheduleLocalTurn(ctx, turn, params.now);
}

/**
 * Removes the Workspace row and emits `workspace.deleted`, then hands the
 * operation to global cleanup — all in the transaction that settles the
 * local task, so "the parent is gone" and "something is driving the
 * directory cleanup" cannot come apart.
 *
 * The child count is re-read first. FK RESTRICT is the safety net the
 * design wants (thousands of edges are never handed to a parent CASCADE),
 * so a child the manifest never fixed must re-open the walk instead of
 * failing the delete. Appends are idempotent per target, which is what
 * makes re-walking from the start cheap and safe.
 */
async function retireWorkspace(
  ctx: ScopeUnitOfWorkContext,
  params: Readonly<{
    workspaceId: WorkspaceId;
    turn: WorkspaceDeletionLocalTurn;
    now: Date;
  }>,
): Promise<void> {
  const { workspaceId, turn, now } = params;
  const probe = { page: 1, limit: 1 };
  const members = await ctx.membershipRepository.listByWorkspace(
    workspaceId,
    probe,
  );
  const invitations = await ctx.invitationRepository.listByWorkspace(
    workspaceId,
    probe,
  );
  if (members.count > 0 || invitations.count > 0) {
    await scheduleLocalTurn(
      ctx,
      { ...turn, phase: "memberships", cursor: null },
      now,
    );
    return;
  }

  const versioned = await ctx.workspaceRepository.findById(workspaceId);
  if (versioned !== null) {
    await ctx.workspaceRepository.delete(
      workspaceId,
      versioned.expectedVersion,
    );
    ctx.collectEvents([
      WorkspaceEvents.workspaceDeleted(workspaceId, turn.operationId, now),
    ]);
  }
  // The manifest and the admission tombstone deliberately outlive the
  // row: global cleanup reads its targets from the manifest, never from
  // source data that no longer exists.
  await scheduleGlobalTurn(
    ctx,
    { operationId: turn.operationId, cursor: null, slug: turn.slug },
    now,
  );
  await ctx.scopeTaskScheduler.complete(
    WORKSPACE_DELETION_LOCAL_TASK_KIND,
    turn.operationId,
  );
}
