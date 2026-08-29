import type { WorkspaceId } from "@repo/core/domain/workspace/valueObject";
import { isConflictError, SystemError, SystemErrorCode } from "../errors";
import type { ScopeUnitOfWorkContext } from "../execution/unitOfWork";
import {
  type ScopeTaskPayload,
  ScopeTaskPriority,
} from "../ports/scopeTaskScheduler";
import type { ScopeKey } from "../scope";

/**
 * Transport of the workspace-deletion saga
 * (spec/usecases/workspace.md#deleteworkspace).
 *
 * Every turn rides the **scope plane's** `scheduled_tasks` rather than the
 * global outbox, as 手順 3 / 5 / 7 require: the manifest, the admission
 * state and the rows being deleted all live in the workspace scope, and a
 * task row is stored in the same transaction as the turn that produced it,
 * so a lost response cannot drop the rest of the work
 * ([ADR 040](spec/adr/040-continuation-transport.md)).
 *
 * A row is keyed `(kind, operationId)` and `schedule` upserts on that key,
 * which is this transport's form of the deterministic continuation id
 * ([ADR 041](spec/adr/041-deterministic-continuation-event-id.md)): a turn
 * replayed after a lost response re-writes its own row instead of forking
 * the chain in two. The payload carries the deletion's `operationId` as
 * 手順 6 demands, and every turn re-enters through `assertDeletionOwner`
 * with it, so a foreign or terminal operation is refused rather than
 * admitted past a closed scope.
 *
 * The three kinds are the phases the spec separates, in order: local
 * (manifest build → local edge deletion → the Workspace row itself),
 * global cleanup (directory tombstone, slug release, directory edges and
 * invitation routes), then compaction of the acknowledged manifest.
 */

/** 手順 5 / 6 — the local half, resumed from its own payload. */
export const WORKSPACE_DELETION_LOCAL_TASK_KIND =
  "workspace.deletionLocalContinued";
/**
 * 手順 7's global orchestrator. It is driven as a scope task because the
 * manifest it walks is scope-local and a task row is the only durable,
 * leased driver this runtime has that is keyed by the deletion operation.
 */
export const WORKSPACE_DELETION_GLOBAL_TASK_KIND =
  "workspace.deletionGlobalCleanupContinued";
/** 手順 7's ack compaction, up to `markCompleted`. */
export const WORKSPACE_DELETION_COMPACT_TASK_KIND =
  "workspace.deletionManifestCompactContinued";

/** Targets one turn advances (spec/domains/index.md: at most 100). */
export const WORKSPACE_DELETION_PAGE_LIMIT = 100;

export type WorkspaceDeletionLocalPhase =
  | "memberships"
  | "invitations"
  | "localDelete";

/**
 * `cursor` is the page position this turn starts from; `slug` and
 * `advertisedSlug` are the two candidate keys the workspace may still
 * hold on the global plane when the deletion is accepted — what the scope
 * named, and what `workspace_directory` was advertising.
 *
 * Both are carried, because either one alone is a guess: a rename whose
 * `activate` was lost moved the scope past the key it holds, and one
 * whose projection was lost moved the key past what the directory says.
 * Global cleanup frees both (`advertisedSlug` in
 * `application/workspace/changeWorkspaceSlug.ts` states the rule), and
 * releasing a key this workspace no longer holds writes nothing.
 *
 * They are fixed at admission rather than re-read: cleanup runs after the
 * Workspace row and the directory row are already gone, and the scope has
 * been closed to mutation since `beginDeletion`, so nothing moves either
 * value after the deletion is accepted.
 */
export type WorkspaceDeletionLocalTurn = Readonly<{
  operationId: string;
  phase: WorkspaceDeletionLocalPhase;
  cursor: string | null;
  slug: string | null;
  advertisedSlug: string | null;
}>;

export type WorkspaceDeletionGlobalTurn = Readonly<{
  operationId: string;
  cursor: string | null;
  slug: string | null;
  advertisedSlug: string | null;
}>;

export type WorkspaceDeletionCompactTurn = Readonly<{ operationId: string }>;

const corrupt = (detail: string): SystemError =>
  new SystemError(
    SystemErrorCode.DataIntegrityError,
    `Workspace deletion continuation: ${detail}`,
  );

const readString = (payload: ScopeTaskPayload, field: string): string => {
  const value = payload[field];
  if (typeof value !== "string" || value.length === 0) {
    throw corrupt(`payload carries no ${field}`);
  }
  return value;
};

const readNullableString = (
  payload: ScopeTaskPayload,
  field: string,
): string | null => {
  const value = payload[field];
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== "string" || value.length === 0) {
    throw corrupt(`payload carries an invalid ${field}`);
  }
  return value;
};

const readPhase = (payload: ScopeTaskPayload): WorkspaceDeletionLocalPhase => {
  const phase = readString(payload, "phase");
  if (
    phase !== "memberships" &&
    phase !== "invitations" &&
    phase !== "localDelete"
  ) {
    throw corrupt(`unknown local phase ${phase}`);
  }
  return phase;
};

export const readLocalTurn = (
  payload: ScopeTaskPayload,
): WorkspaceDeletionLocalTurn => ({
  operationId: readString(payload, "operationId"),
  phase: readPhase(payload),
  cursor: readNullableString(payload, "cursor"),
  slug: readNullableString(payload, "slug"),
  advertisedSlug: readNullableString(payload, "advertisedSlug"),
});

export const readGlobalTurn = (
  payload: ScopeTaskPayload,
): WorkspaceDeletionGlobalTurn => ({
  operationId: readString(payload, "operationId"),
  cursor: readNullableString(payload, "cursor"),
  slug: readNullableString(payload, "slug"),
  advertisedSlug: readNullableString(payload, "advertisedSlug"),
});

export const readCompactTurn = (
  payload: ScopeTaskPayload,
): WorkspaceDeletionCompactTurn => ({
  operationId: readString(payload, "operationId"),
});

/**
 * The deletion runs against the workspace scope alone; a task claimed for
 * any other scope is a routing fault rather than a state the saga can
 * recover from.
 */
export const requireWorkspaceScope = (scope: ScopeKey): WorkspaceId => {
  if (scope.type !== "workspace") {
    throw corrupt(`scope ${scope.type} does not own a workspace deletion`);
  }
  return scope.workspaceId;
};

/**
 * Stores the next turn in the transaction of the turn that produced it.
 * Deletion is `securityCleanup` priority — it closes off access, so it
 * runs ahead of projection and expiry work in the same scope.
 */
export const scheduleLocalTurn = (
  ctx: ScopeUnitOfWorkContext,
  turn: WorkspaceDeletionLocalTurn,
  now: Date,
): Promise<void> =>
  ctx.scopeTaskScheduler.schedule({
    kind: WORKSPACE_DELETION_LOCAL_TASK_KIND,
    operationId: turn.operationId,
    priority: ScopeTaskPriority.securityCleanup,
    dueAt: now,
    payload: { ...turn },
  });

export const scheduleGlobalTurn = (
  ctx: ScopeUnitOfWorkContext,
  turn: WorkspaceDeletionGlobalTurn,
  now: Date,
): Promise<void> =>
  ctx.scopeTaskScheduler.schedule({
    kind: WORKSPACE_DELETION_GLOBAL_TASK_KIND,
    operationId: turn.operationId,
    priority: ScopeTaskPriority.securityCleanup,
    dueAt: now,
    payload: { ...turn },
  });

export const scheduleCompactTurn = (
  ctx: ScopeUnitOfWorkContext,
  turn: WorkspaceDeletionCompactTurn,
  now: Date,
): Promise<void> =>
  ctx.scopeTaskScheduler.schedule({
    kind: WORKSPACE_DELETION_COMPACT_TASK_KIND,
    operationId: turn.operationId,
    priority: ScopeTaskPriority.securityCleanup,
    dueAt: now,
    payload: { ...turn },
  });

/**
 * Admits one turn of the deletion (手順 6: a continuation is accepted only
 * while its operation id matches the Workspace lifecycle or the surviving
 * manifest header).
 *
 * A refusal settles the row instead of failing the turn. Once the manifest
 * reaches its completed tombstone — or if a row were ever stranded by
 * another operation — there is nothing left to continue, and leaving the
 * row due would re-enter this same refusal on every tick. This is the
 * boundary catch a worker is allowed (CLAUDE.md "Cross-layer catch
 * policy"); anything that is not an admission conflict propagates.
 */
export async function admitDeletionTurn(
  ctx: ScopeUnitOfWorkContext,
  kind: string,
  operationId: string,
): Promise<boolean> {
  try {
    await ctx.workspaceOperationLockStore.assertDeletionOwner(operationId);
    return true;
  } catch (cause) {
    if (!isConflictError(cause)) {
      throw cause;
    }
    await ctx.scopeTaskScheduler.complete(kind, operationId);
    return false;
  }
}
