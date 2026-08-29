import { WorkspaceSlug } from "@repo/core/domain/workspace/valueObject";
import type { WorkerContainer } from "../di/types";
import type { ScopeTaskPayload } from "../ports/scopeTaskScheduler";
import type { ScopeKey } from "../scope";
import {
  admitDeletionTurn,
  readCompactTurn,
  readGlobalTurn,
  requireWorkspaceScope,
  scheduleCompactTurn,
  scheduleGlobalTurn,
  WORKSPACE_DELETION_COMPACT_TASK_KIND,
  WORKSPACE_DELETION_GLOBAL_TASK_KIND,
  WORKSPACE_DELETION_PAGE_LIMIT,
} from "./workspaceDeletion";

/**
 * The global half of a workspace deletion
 * (spec/usecases/workspace.md#deleteworkspace 手順 7).
 *
 * Two lanes, both driven a page at a time off the scope-local manifest:
 * this file's cleanup turns delete the global rows the manifest names, and
 * the compaction turns reclaim the items once both acknowledgements are
 * in, ending at the completed tombstone.
 *
 * Nothing here re-reads source data. By the time it runs, the Workspace
 * row and its children are already gone, so every target is taken from
 * the manifest item — the `userId` of a membership directory edge, the
 * `tokenHash` of an invitation route — which is exactly why those keys are
 * fixed next to the local ids in the first place.
 *
 * The two planes never share a transaction: a turn reads its page in the
 * scope's unit of work, issues the global deletes outside any, then
 * acknowledges and stores its successor in a second scope transaction. A
 * response lost between them repeats deletes that are idempotent on their
 * target state, and the unfiltered manifest walk is what makes re-sending
 * a delete for an already-acknowledged item a no-op rather than an error.
 */

/**
 * Deletes the global rows one manifest page names and acknowledges them.
 *
 * The first turn of the operation — the one that starts at a null cursor —
 * also tombstones the directory row and frees the slug, in that order: the
 * tombstone is what makes the public route stop resolving, and only once
 * it holds may the slug be handed back, or the surviving tombstone would
 * block the next workspace that takes the same slug. Both are idempotent
 * for this operation, so a replayed first turn repeats them harmlessly and
 * later turns skip them entirely.
 *
 * *Both* candidate keys the turn carries are freed, not the one the scope
 * named. The workspace is disappearing, so this is the last call that
 * could free either, and an `active` reservation has no expiry behind it;
 * `advertisedSlug` in `application/workspace/changeWorkspaceSlug.ts`
 * states why neither candidate is reliable on its own and why freeing the
 * wrong one writes nothing.
 */
export async function continueWorkspaceDeletionGlobalCleanup(
  container: WorkerContainer,
  params: Readonly<{ scope: ScopeKey; payload: ScopeTaskPayload }>,
): Promise<void> {
  const workspaceId = requireWorkspaceScope(params.scope);
  const turn = readGlobalTurn(params.payload);
  const now = container.clock.now();

  const page = await container.scopeUnitOfWorkProvider.run(
    params.scope,
    async (ctx) => {
      if (
        !(await admitDeletionTurn(
          ctx,
          WORKSPACE_DELETION_GLOBAL_TASK_KIND,
          turn.operationId,
        ))
      ) {
        return null;
      }
      return ctx.workspaceDeletionManifestStore.listItems(
        turn.operationId,
        turn.cursor,
        WORKSPACE_DELETION_PAGE_LIMIT,
      );
    },
  );
  if (page === null) {
    return;
  }

  if (turn.cursor === null) {
    await container.workspaceDirectoryProjectionWriter.tombstone({
      workspaceId,
      operationId: turn.operationId,
    });
    const freed = new Set<string>();
    for (const candidate of [turn.slug, turn.advertisedSlug]) {
      if (candidate === null || freed.has(candidate)) {
        continue;
      }
      freed.add(candidate);
      await container.workspaceSlugReservationStore.release({
        slug: WorkspaceSlug.create(candidate),
        workspaceId,
      });
    }
  }

  for (const item of page.items) {
    if (item.kind === "membership") {
      // `removing` first, then gone: the edge is the last pointer the
      // member's own shard has to this scope, and dropping it without
      // the announced phase is what the store refuses. An edge a join
      // never settled is taken by the announcement as well, so a lost
      // `activate` cannot park this turn on an item no retry clears.
      await container.membershipDirectoryReservationStore.beginRemoval(
        item.userId,
        workspaceId,
      );
      await container.membershipDirectoryReservationStore.completeRemoval(
        item.userId,
        workspaceId,
      );
      continue;
    }
    await container.invitationRouteStore.revoke({
      tokenHash: item.tokenHash,
      invitationId: item.invitationId,
      operationId: turn.operationId,
    });
  }

  await container.scopeUnitOfWorkProvider.run(params.scope, async (ctx) => {
    if (
      !(await admitDeletionTurn(
        ctx,
        WORKSPACE_DELETION_GLOBAL_TASK_KIND,
        turn.operationId,
      ))
    ) {
      return;
    }
    await ctx.workspaceDeletionManifestStore.acknowledge(
      turn.operationId,
      page.items.map((item) => item.key),
    );
    if (page.nextCursor !== null) {
      await scheduleGlobalTurn(ctx, { ...turn, cursor: page.nextCursor }, now);
      return;
    }
    await scheduleCompactTurn(ctx, { operationId: turn.operationId }, now);
    await ctx.scopeTaskScheduler.complete(
      WORKSPACE_DELETION_GLOBAL_TASK_KIND,
      turn.operationId,
    );
  });
}

/**
 * Reclaims the doubly-acknowledged manifest items a page at a time and
 * completes the header on the page that empties it.
 *
 * The header transition never shares a transaction with a full page of
 * deletes, which is what keeps a manifest of thousands of items from being
 * emptied in the transaction that completes it. Completing last is also
 * what makes the tombstone mean "nothing left to reclaim", and it is the
 * point where `assertDeletionOwner` turns false — a redelivered turn of
 * any phase then settles its row instead of restarting cleanup.
 *
 * Compaction only ever starts once every item carries both
 * acknowledgements, so `remaining` normally means "more pages". A page
 * that removes nothing while items remain is the abnormal case — an
 * acknowledgement that never landed — and backs the row off rather than
 * re-arming it at once, so a stalled operation ages visibly instead of
 * spinning.
 */
export async function compactWorkspaceDeletionManifest(
  container: WorkerContainer,
  params: Readonly<{ scope: ScopeKey; payload: ScopeTaskPayload }>,
): Promise<void> {
  const turn = readCompactTurn(params.payload);
  const now = container.clock.now();

  await container.scopeUnitOfWorkProvider.run(params.scope, async (ctx) => {
    if (
      !(await admitDeletionTurn(
        ctx,
        WORKSPACE_DELETION_COMPACT_TASK_KIND,
        turn.operationId,
      ))
    ) {
      return;
    }
    const page = await ctx.workspaceDeletionManifestStore.compactAcknowledged(
      turn.operationId,
      WORKSPACE_DELETION_PAGE_LIMIT,
    );
    if (page.remaining) {
      if (page.removed === 0) {
        await ctx.scopeTaskScheduler.backoff(
          WORKSPACE_DELETION_COMPACT_TASK_KIND,
          turn.operationId,
          now,
        );
        return;
      }
      await scheduleCompactTurn(ctx, turn, now);
      return;
    }
    await ctx.workspaceDeletionManifestStore.markCompleted(turn.operationId);
    await ctx.scopeTaskScheduler.complete(
      WORKSPACE_DELETION_COMPACT_TASK_KIND,
      turn.operationId,
    );
  });
}
