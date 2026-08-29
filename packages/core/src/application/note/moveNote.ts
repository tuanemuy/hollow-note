import { BusinessRuleError } from "@repo/core/domain/error";
import { UserId } from "@repo/core/domain/identity/valueObject";
import { NoteEvents } from "@repo/core/domain/note/events";
import { type ActiveNote, Note } from "@repo/core/domain/note/note";
import type { NoteRevision } from "@repo/core/domain/note/noteRevision";
import { NoteOwnershipPolicy } from "@repo/core/domain/note/services/noteOwnershipPolicy";
import { NoteId, NoteOwner } from "@repo/core/domain/note/valueObject";
import { StorageOwner } from "@repo/core/domain/storage/valueObject";
import { StorageQuota } from "@repo/core/domain/usage/storageQuota";
import { QuotaSubject } from "@repo/core/domain/usage/valueObject";
import { WorkspaceErrorCode } from "@repo/core/domain/workspace/errorCode";
import { WorkspaceAuthorization } from "@repo/core/domain/workspace/services/workspaceAuthorization";
import { WorkspaceId } from "@repo/core/domain/workspace/valueObject";
import type { RequestContainer } from "../di/types";
import {
  ConflictError,
  isConflictError,
  NotFoundError,
  SystemError,
  SystemErrorCode,
} from "../errors";
import type { ScopeUnitOfWorkContext } from "../execution/unitOfWork";
import type { DistributedOperationPayload } from "../ports/distributedOperationStore";
import { ScopeKey } from "../scope";
import {
  type MovedFileMetadata,
  relocateFilesForNote,
} from "../storage/relocateFilesForNote";
import type { ServiceArgs } from "../types";
import { resolveWorkspaceAccess } from "../workspace/resolveWorkspaceAccess";
import { noteAccessPolicy, viewerFor } from "./accessControl";
import { ownerOf } from "./view";

export type MoveNoteInput = Readonly<{
  noteId: string;
  userId: string;
  targetOwnerType: "user" | "workspace";
  targetWorkspaceId?: string | null;
  expectedVersion: number;
}>;

export type MovedNoteView = Readonly<{
  noteId: string;
  ownerType: "user" | "workspace";
  ownerId: string;
  droppedTagNames: readonly string[];
  version: number;
}>;

/**
 * Seam for the tag half of a move (UC-tag-012
 * `relocateAssignmentsForNote`, spec/usecases/tag.md).
 *
 * The tag domain does not exist yet — it lands with Issue #8 — so this
 * slice ships the call sites and no implementation. The three members are
 * the same phases the note itself moves through: `plan` runs before the
 * operation is created, because the dropped names are fixed into the
 * operation payload and must not be recomputed on a resume
 * (spec/usecases/note.md#movenote 手順 3); `stageTarget` and
 * `retireSource` receive the unit of work of the phase they belong to, so
 * an assignment change commits with the note write that caused it.
 */
export interface NoteMoveTagRelocation {
  plan(
    container: RequestContainer,
    input: Readonly<{ noteId: NoteId; source: ScopeKey; target: ScopeKey }>,
  ): Promise<readonly string[]>;
  stageTarget(
    ctx: ScopeUnitOfWorkContext,
    input: Readonly<{ migrationId: string; noteId: NoteId; target: ScopeKey }>,
  ): Promise<void>;
  retireSource(
    ctx: ScopeUnitOfWorkContext,
    input: Readonly<{ migrationId: string; noteId: NoteId; source: ScopeKey }>,
  ): Promise<void>;
}

/** The seam's only implementation until the tag slice lands (Issue #8). */
export const noTagRelocation: NoteMoveTagRelocation = {
  async plan(): Promise<readonly string[]> {
    return [];
  },
  async stageTarget(): Promise<void> {},
  async retireSource(): Promise<void> {},
};

export type MoveNoteArgs = ServiceArgs<MoveNoteInput> &
  Readonly<{ tagRelocation?: NoteMoveTagRelocation }>;

/** Retention invariant of `NoteRevision`: the newest 20 per note. */
const REVISION_RETENTION = 20;

const STAGE_TARGET_COMMAND = "note.moveStageTarget";
const RETIRE_SOURCE_COMMAND = "note.moveRetireSource";
const ABORT_TARGET_COMMAND = "note.moveAbortTarget";

const noteNotFound = (): NotFoundError =>
  new NotFoundError("NOTE_NOT_FOUND", "Note not found");

const insufficientTargetRole = (): BusinessRuleError<WorkspaceErrorCode> =>
  new BusinessRuleError(
    WorkspaceErrorCode.InsufficientRole,
    "Not allowed to move a note into this workspace",
  );

const staleMembership = (scope: ScopeKey): ConflictError =>
  new ConflictError(
    "STALE_MEMBERSHIP",
    `The membership pinned for ${ScopeKey.serialize(scope)} changed during the move`,
  );

const corrupt = (detail: string): SystemError =>
  new SystemError(
    SystemErrorCode.DataIntegrityError,
    `Note move operation: ${detail}`,
  );

/**
 * Input the move's state machine is fixed on. It is written into the
 * `distributed_operations` payload at creation and read back on every
 * resume, so a re-request never re-derives values that may have moved
 * since ([ADR 041](spec/adr/041-deterministic-continuation-event-id.md)
 * applied to a saga's own control row).
 *
 * `routeVersion` is deliberately absent: it is the one value a resume
 * must re-read, because the route is what a competing operation moves.
 */
type MovePlan = Readonly<{
  migrationId: string;
  noteId: NoteId;
  actorUserId: UserId;
  source: ScopeKey;
  target: ScopeKey;
  sourceMembershipVersion: number | null;
  targetMembershipVersion: number | null;
  droppedTagNames: readonly string[];
}>;

type MoveSnapshot = Readonly<{
  note: ActiveNote;
  revisions: readonly NoteRevision[];
  files: readonly MovedFileMetadata[];
  bytes: number;
}>;

const noteOwnerOf = (scope: ScopeKey): NoteOwner =>
  scope.type === "user"
    ? NoteOwner.user(scope.userId)
    : NoteOwner.workspace(scope.workspaceId);

const storageOwnerOf = (scope: ScopeKey): StorageOwner =>
  scope.type === "user"
    ? StorageOwner.user(scope.userId)
    : StorageOwner.workspace(scope.workspaceId);

const quotaSubjectOf = (scope: ScopeKey): QuotaSubject =>
  QuotaSubject.fromStorageOwner(storageOwnerOf(scope));

const serializeScope = ScopeKey.serialize;

const parseScope = (raw: string): ScopeKey => {
  const separator = raw.indexOf(":");
  if (separator < 0) {
    throw corrupt(`payload carries an unreadable scope ${raw}`);
  }
  const kind = raw.slice(0, separator);
  const id = raw.slice(separator + 1);
  if (id.length === 0) {
    throw corrupt(`payload carries an unreadable scope ${raw}`);
  }
  if (kind === "user") {
    return ScopeKey.user(UserId.create(id));
  }
  if (kind === "workspace") {
    return ScopeKey.workspace(WorkspaceId.create(id));
  }
  throw corrupt(`payload carries an unknown scope kind ${kind}`);
};

const readString = (
  payload: DistributedOperationPayload,
  field: string,
): string => {
  const value = payload[field];
  if (typeof value !== "string" || value.length === 0) {
    throw corrupt(`payload carries no ${field}`);
  }
  return value;
};

const readNullableInteger = (
  payload: DistributedOperationPayload,
  field: string,
): number | null => {
  const value = payload[field];
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw corrupt(`payload carries an invalid ${field}`);
  }
  return value;
};

const readTagNames = (
  payload: DistributedOperationPayload,
): readonly string[] => {
  const value = payload.droppedTagNames;
  if (!Array.isArray(value)) {
    throw corrupt("payload carries no droppedTagNames");
  }
  return value.map((name) => {
    if (typeof name !== "string") {
      throw corrupt("payload carries a non-string dropped tag name");
    }
    return name;
  });
};

const toPayload = (
  plan: Omit<MovePlan, "migrationId">,
): DistributedOperationPayload => ({
  noteId: plan.noteId,
  actorUserId: plan.actorUserId,
  source: serializeScope(plan.source),
  target: serializeScope(plan.target),
  sourceMembershipVersion: plan.sourceMembershipVersion,
  targetMembershipVersion: plan.targetMembershipVersion,
  droppedTagNames: [...plan.droppedTagNames],
});

const readPlan = (
  migrationId: string,
  payload: DistributedOperationPayload,
): MovePlan => ({
  migrationId,
  noteId: NoteId.create(readString(payload, "noteId")),
  actorUserId: UserId.create(readString(payload, "actorUserId")),
  source: parseScope(readString(payload, "source")),
  target: parseScope(readString(payload, "target")),
  sourceMembershipVersion: readNullableInteger(
    payload,
    "sourceMembershipVersion",
  ),
  targetMembershipVersion: readNullableInteger(
    payload,
    "targetMembershipVersion",
  ),
  droppedTagNames: readTagNames(payload),
});

/**
 * Re-checks, inside the phase's own transaction, the membership the
 * pre-flight authorization rested on.
 *
 * The pinned version is the whole guarantee: a removal deletes the row and
 * a demotion bumps its version, so "the role is still what it was" needs
 * no second role lookup. That is what makes a member who was removed
 * *while the move ran* fail at the moment the move commits rather than
 * slipping through on a decision taken seconds earlier.
 */
async function ensurePinnedMembership(
  ctx: ScopeUnitOfWorkContext,
  scope: ScopeKey,
  actorUserId: UserId,
  expectedVersion: number | null,
  onMissing: () => Error,
): Promise<void> {
  if (scope.type !== "workspace") {
    return;
  }
  const membership = await ctx.membershipRepository.findByWorkspaceAndUser(
    scope.workspaceId,
    actorUserId,
  );
  if (membership === null) {
    throw onMissing();
  }
  if ((membership.expectedVersion as number) !== expectedVersion) {
    throw staleMembership(scope);
  }
}

/**
 * Applies a storage delta to a scope's quota. Notes and bytes move
 * together, so both are one write; the quota limit is deliberately not
 * consulted (spec/usecases/note.md#movenote: quota is enforced on intake
 * only, and a move that overshoots merely blocks the next upload).
 */
async function applyStorageDelta(
  ctx: ScopeUnitOfWorkContext,
  scope: ScopeKey,
  byteDelta: number,
  noteDelta: 1 | -1,
  now: Date,
): Promise<void> {
  const subject = quotaSubjectOf(scope);
  const stored = await ctx.storageQuotaRepository.find(subject);
  const base = stored?.entity ?? StorageQuota.initialize(subject, now);
  const withBytes =
    byteDelta >= 0
      ? StorageQuota.add(base, byteDelta, now)
      : StorageQuota.subtract(base, -byteDelta, now);
  const next =
    noteDelta === 1
      ? StorageQuota.incrementNotes(withBytes, now)
      : StorageQuota.decrementNotes(withBytes, now);
  if (stored === null) {
    await ctx.storageQuotaRepository.insert(next);
  } else {
    await ctx.storageQuotaRepository.save(next, stored.expectedVersion);
  }
}

/**
 * 手順 5 — freezes the source side into a transferable snapshot and
 * stages the source half of the move authorization lock.
 *
 * Nothing is deleted here: the route still points at the source, so a
 * reader that arrives before the switch must still find the whole note.
 * `reauthorize` is false only on the forward-only leg after the switch,
 * where a refusal would strand a note that has already changed hands.
 *
 * The lock is staged inside this transaction, so from the moment the
 * freeze commits a workspace deletion and a mutation of the actor's own
 * membership both lose to the move rather than the other way round.
 */
async function snapshotSource(
  container: RequestContainer,
  plan: MovePlan,
  reauthorize: boolean,
): Promise<MoveSnapshot | null> {
  return container.scopeUnitOfWorkProvider.run(plan.source, async (ctx) => {
    if (reauthorize) {
      await ctx.cleanupAdmission.assertWritable();
      await ctx.cleanupAdmission.assertActorWritable(plan.actorUserId);
      await ctx.workspaceOperationLockStore.assertWritable();
      await ensurePinnedMembership(
        ctx,
        plan.source,
        plan.actorUserId,
        plan.sourceMembershipVersion,
        // A member removed mid-move learns nothing about the note that is
        // no longer theirs (spec error table: 移動元の権限不足).
        noteNotFound,
      );
    }
    await ctx.workspaceOperationLockStore.stageMove({
      migrationId: plan.migrationId,
      actorUserId: plan.actorUserId,
    });

    const versioned = await ctx.noteRepository.findById(plan.noteId);
    if (versioned === null) {
      return null;
    }
    const note = versioned.entity;
    if (!Note.isActive(note)) {
      throw noteNotFound();
    }

    const revisions = await ctx.noteRevisionRepository.listByNote(
      plan.noteId,
      REVISION_RETENTION,
    );
    const { files } = await relocateFilesForNote(ctx, {
      migrationId: plan.migrationId,
      phase: "snapshotSource",
      noteId: plan.noteId,
      owner: storageOwnerOf(plan.source),
      targetOwner: storageOwnerOf(plan.target),
      now: container.clock.now(),
    });

    return {
      note,
      revisions,
      files,
      bytes: files.reduce((total, file) => total + file.size, 0),
    };
  });
}

/**
 * 手順 6 — stages the note in the target scope and credits its usage.
 *
 * The whole phase is one target-local transaction, which is what makes
 * "the target admits this actor", "the target's move lock stands" and
 * "the target now holds the data" inseparable. `note.moved` is *not*
 * emitted here: nothing has changed
 * hands until the route switch, and a consumer that saw the event first
 * would resolve the note back to the source.
 */
async function stageTarget(
  container: RequestContainer,
  plan: MovePlan,
  snapshot: MoveSnapshot,
  routeVersion: number,
  tagRelocation: NoteMoveTagRelocation,
): Promise<void> {
  const now = container.clock.now();
  await container.scopeUnitOfWorkProvider.run(plan.target, async (ctx) => {
    await ctx.cleanupAdmission.assertWritable();
    await ctx.cleanupAdmission.assertActorWritable(plan.actorUserId);
    await ctx.workspaceOperationLockStore.assertWritable();
    await ensurePinnedMembership(
      ctx,
      plan.target,
      plan.actorUserId,
      plan.targetMembershipVersion,
      insufficientTargetRole,
    );
    // Ahead of the idempotence guard, so a replay re-states the lock the
    // activation below is going to release. Staging is itself idempotent
    // on the migration id, so the repeat costs nothing.
    await ctx.workspaceOperationLockStore.stageMove({
      migrationId: plan.migrationId,
      actorUserId: plan.actorUserId,
    });

    if (
      !(await ctx.appliedOperationStore.markApplied({
        operationId: plan.migrationId,
        commandKey: STAGE_TARGET_COMMAND,
      }))
    ) {
      return;
    }

    const moved = Note.moveTo(
      snapshot.note,
      noteOwnerOf(plan.target),
      routeVersion + 1,
      now,
    );
    await ctx.noteRepository.insert(moved.entity);
    for (const revision of snapshot.revisions) {
      await ctx.noteRevisionRepository.insert(revision);
    }
    await relocateFilesForNote(ctx, {
      migrationId: plan.migrationId,
      phase: "stageTarget",
      noteId: plan.noteId,
      owner: storageOwnerOf(plan.target),
      targetOwner: storageOwnerOf(plan.target),
      files: snapshot.files,
      now,
    });
    await applyStorageDelta(ctx, plan.target, snapshot.bytes, 1, now);
    await ctx.noteProjectionRevisionStore.bump(plan.noteId);
    await tagRelocation.stageTarget(ctx, {
      migrationId: plan.migrationId,
      noteId: plan.noteId,
      target: plan.target,
    });
  });
}

/**
 * 手順 8 前半 — activates the target by releasing its move lock.
 *
 * It runs after the switch because the lock's whole purpose is to keep
 * the target from being deleted, and its actor from being demoted, while
 * the staged copy is the only one that exists but is not yet reachable.
 * Once the route points at the target that window is closed.
 *
 * Unguarded by `AppliedOperationStore`: releasing is idempotent by
 * contract, and a guard would make a replayed activation skip the
 * release that its own replayed staging just re-applied.
 */
async function activateTarget(
  container: RequestContainer,
  plan: MovePlan,
): Promise<void> {
  await container.scopeUnitOfWorkProvider.run(plan.target, (ctx) =>
    ctx.workspaceOperationLockStore.releaseMove(plan.migrationId),
  );
}

/**
 * 手順 8 後半 / 9 — retires the source rows and publishes `note.moved`.
 *
 * Forward-only: the route already points at the target, so this phase
 * asks no admission question it could be refused on. It is deduplicated
 * on the migration id instead, which is what lets a lost response replay
 * without debiting the source twice. Releasing the source's move lock
 * sits ahead of that guard for the same reason activation is unguarded.
 *
 * The event is collected here rather than in the staging transaction
 * because this is the first transaction that runs *after* the switch —
 * the point where the change of ownership is real for a reader.
 */
async function retireSource(
  container: RequestContainer,
  plan: MovePlan,
  snapshot: MoveSnapshot,
  routeVersion: number,
  tagRelocation: NoteMoveTagRelocation,
): Promise<void> {
  const now = container.clock.now();
  await container.scopeUnitOfWorkProvider.run(plan.source, async (ctx) => {
    await ctx.workspaceOperationLockStore.releaseMove(plan.migrationId);
    if (
      !(await ctx.appliedOperationStore.markApplied({
        operationId: plan.migrationId,
        commandKey: RETIRE_SOURCE_COMMAND,
      }))
    ) {
      return;
    }

    const versioned = await ctx.noteRepository.findById(plan.noteId);
    if (versioned !== null) {
      await ctx.noteRepository.delete(plan.noteId, versioned.expectedVersion);
    }
    await ctx.noteRevisionRepository.deleteByNote(plan.noteId);
    await relocateFilesForNote(ctx, {
      migrationId: plan.migrationId,
      phase: "retireSource",
      noteId: plan.noteId,
      owner: storageOwnerOf(plan.source),
      targetOwner: storageOwnerOf(plan.target),
      files: snapshot.files,
      now,
    });
    await applyStorageDelta(ctx, plan.source, -snapshot.bytes, -1, now);
    await ctx.localNoteProjectionWriter.remove(plan.noteId);
    await tagRelocation.retireSource(ctx, {
      migrationId: plan.migrationId,
      noteId: plan.noteId,
      source: plan.source,
    });

    ctx.collectEvents([
      NoteEvents.moved(
        {
          noteId: plan.noteId,
          previousOwner: snapshot.note.owner,
          currentOwner: noteOwnerOf(plan.target),
          routeVersion: routeVersion + 1,
        },
        now,
      ),
    ]);
  });
}

/**
 * Reverses everything the pre-switch legs may have left behind, then
 * thaws the route (spec/usecases/note.md#movenote 手順 4〜6 の中止).
 *
 * The target undo is guarded by its own applied-operation key so a second
 * abort of the same migration cannot debit the target twice, and it
 * returns before touching usage when nothing was staged. Both scopes'
 * move locks are released outside that guard, since an abort may follow a
 * failure that never reached the staging it is undoing.
 */
async function abortBeforeSwitch(
  container: RequestContainer,
  plan: MovePlan,
  snapshot: MoveSnapshot | null,
  routeVersion: number,
): Promise<void> {
  const now = container.clock.now();
  await container.scopeUnitOfWorkProvider.run(plan.target, async (ctx) => {
    await ctx.workspaceOperationLockStore.releaseMove(plan.migrationId);
    if (
      !(await ctx.appliedOperationStore.markApplied({
        operationId: plan.migrationId,
        commandKey: ABORT_TARGET_COMMAND,
      }))
    ) {
      return;
    }
    const staged = await ctx.noteRepository.findById(plan.noteId);
    if (staged === null) {
      return;
    }
    await ctx.noteRepository.delete(plan.noteId, staged.expectedVersion);
    await ctx.noteRevisionRepository.deleteByNote(plan.noteId);
    const files = snapshot?.files ?? [];
    await relocateFilesForNote(ctx, {
      migrationId: plan.migrationId,
      // Removing the staged rows is the same operation as retiring a
      // source, seen from the scope that is giving the metadata back.
      phase: "retireSource",
      noteId: plan.noteId,
      owner: storageOwnerOf(plan.target),
      targetOwner: storageOwnerOf(plan.source),
      files,
      now,
    });
    await applyStorageDelta(ctx, plan.target, -(snapshot?.bytes ?? 0), -1, now);
  });

  await container.scopeUnitOfWorkProvider.run(plan.source, (ctx) =>
    ctx.workspaceOperationLockStore.releaseMove(plan.migrationId),
  );

  await container.noteRouteStore.abortMove({
    noteId: plan.noteId,
    migrationId: plan.migrationId,
    expectedRouteVersion: routeVersion,
  });
}

/**
 * 手順 4 — claims the route for this migration.
 *
 * A route that moved between the pre-flight read and the claim is re-read
 * once and the claim retried, which is the spec's "route を1回引き直して
 * 既存 operation を再開" — a second conflict is answered rather than
 * looped on.
 */
async function claimRoute(
  container: RequestContainer,
  plan: MovePlan,
): Promise<number> {
  const claim = (expectedRouteVersion: number): Promise<number> =>
    container.noteRouteStore
      .beginMove({
        noteId: plan.noteId,
        expectedRouteVersion,
        target: plan.target,
        migrationId: plan.migrationId,
      })
      .then((route) => route.routeVersion);

  const current = await container.noteRouteStore.resolve(plan.noteId);
  if (current === null) {
    throw noteNotFound();
  }
  try {
    return await claim(current.routeVersion);
  } catch (cause) {
    if (!isConflictError(cause) || cause.code !== "STALE_SCOPE_ROUTE") {
      throw cause;
    }
    const again = await container.noteRouteStore.resolve(plan.noteId);
    if (again === null) {
      throw noteNotFound();
    }
    return claim(again.routeVersion);
  }
}

/**
 * Moves a note to another owner (UC-note-013,
 * spec/usecases/note.md#movenote, OR-12).
 *
 * Four phases, each idempotent under one migration id:
 * `snapshotSource` (freeze + source lock) → `stageTarget` (target-local
 * insert + credit + target lock) → the route switch, which is the single
 * instant the change is visible → `activateTarget` / `retireSource`
 * (locks released, source rows, debit, `note.moved`). Before the switch a
 * failure aborts, both locks are released and the route thaws back to the
 * source; after it, recovery is forward-only.
 *
 * The migration id is the `distributed_operations` row's id, so the same
 * request key replays the same operation and every phase's
 * `AppliedOperationStore` key resolves to the same command. That is what
 * makes a lost response converge instead of duplicating the note, the
 * revisions, the file metadata or the usage delta.
 *
 * Authorization is guarded from two directions, and neither replaces the
 * other. Forwards: the pre-flight pass decides the request (and answers
 * `NOTE_NOT_FOUND` / `WORKSPACE_NOT_FOUND` / `InsufficientRole`), then
 * each phase re-checks the *pinned Membership version* inside its own
 * transaction, which is what catches a change that committed before the
 * phase began. Backwards: each phase stages the move authorization lock
 * in its own scope, which is what makes a workspace deletion or a
 * mutation of the actor's membership attempted *after* that phase lose to
 * the move (`WORKSPACE_MOVE_IN_PROGRESS`) instead of racing it.
 *
 * One piece of 手順 5 is **absent in this slice**: terminating the
 * source's unfinished jobs, because the Job aggregate does not exist
 * (Issue #5). The gap is recorded rather than papered over, the same way
 * `application/cleanup/participants.ts` records the Job gap for account
 * deletion.
 */
export async function moveNote({
  container,
  input,
  tagRelocation = noTagRelocation,
}: MoveNoteArgs): Promise<MovedNoteView> {
  const noteId = NoteId.create(input.noteId);
  const actorUserId = UserId.create(input.userId);

  const route = await container.noteRouteStore.resolve(noteId);
  if (route === null) {
    throw noteNotFound();
  }
  const source = route.scope;

  const stored = await container.noteReaderFor(source).findById(noteId);
  if (stored === null) {
    throw noteNotFound();
  }
  const note = stored.entity;

  const viewer = await viewerFor(container, note.owner, input.userId);
  const access = noteAccessPolicy.evaluate(
    note,
    viewer,
    { tokenHash: null, pass: null },
    container.clock.now(),
  );
  if (access.kind !== "granted" || !access.canEdit) {
    throw noteNotFound();
  }
  // The move UI is reachable from the detail view only, and `Note.moveTo`
  // is defined on an active note; a trashed one is restored first.
  if (!Note.isActive(note)) {
    throw noteNotFound();
  }

  const targetOwner = await resolveTargetOwner(container, input, actorUserId);
  if (NoteOwner.equals(note.owner, targetOwner)) {
    return {
      noteId,
      ...ownerOf(note),
      droppedTagNames: [],
      version: note.version,
    };
  }

  NoteOwnershipPolicy.ensureMovable(note, access, {
    owner: targetOwner,
    canCreate: true,
  });
  if ((stored.expectedVersion as number) !== input.expectedVersion) {
    throw new ConflictError(
      "OPTIMISTIC_LOCK_FAILURE",
      "The note changed during the move",
    );
  }

  const target =
    targetOwner.type === "user"
      ? ScopeKey.user(targetOwner.userId)
      : ScopeKey.workspace(targetOwner.workspaceId);
  const droppedTagNames = await tagRelocation.plan(container, {
    noteId,
    source,
    target,
  });

  const payload = toPayload({
    noteId,
    actorUserId,
    source,
    target,
    sourceMembershipVersion: await membershipVersionOf(
      container,
      source,
      actorUserId,
    ),
    targetMembershipVersion: await membershipVersionOf(
      container,
      target,
      actorUserId,
    ),
    droppedTagNames,
  });
  const { operation } = await container.globalUnitOfWorkProvider.run((ctx) =>
    ctx.distributedOperationStore.beginOrResume({
      kind: "noteMove",
      partitionKey: noteId,
      requestKey: `${noteId}:${serializeScope(target)}:${input.expectedVersion}`,
      payload,
    }),
  );
  const plan = readPlan(operation.id, operation.payload);

  const routeVersion = await claimRoute(container, plan);

  let observed: MoveSnapshot | null = null;
  let snapshot: MoveSnapshot;
  try {
    observed = await snapshotSource(container, plan, true);
    if (observed === null) {
      throw noteNotFound();
    }
    await stageTarget(container, plan, observed, routeVersion, tagRelocation);
    await container.noteRouteStore.switchMove({
      noteId,
      migrationId: plan.migrationId,
      expectedRouteVersion: routeVersion,
    });
    snapshot = observed;
  } catch (cause) {
    await rollBack(container, plan, observed, routeVersion, cause);
    throw cause;
  }

  await activateTarget(container, plan);
  await retireSource(container, plan, snapshot, routeVersion, tagRelocation);
  await settle(container, plan.migrationId, "completed");

  return {
    noteId,
    ...ownerOf({ ...note, owner: targetOwner }),
    droppedTagNames: plan.droppedTagNames,
    version: note.version + 1,
  };
}

/**
 * Compensation boundary. The original failure is what the caller must
 * see, so a failing rollback is logged and swallowed — leaving a route
 * stuck in `moving` is recoverable, replacing the diagnosis is not.
 */
async function rollBack(
  container: RequestContainer,
  plan: MovePlan,
  snapshot: MoveSnapshot | null,
  routeVersion: number,
  cause: unknown,
): Promise<void> {
  try {
    await abortBeforeSwitch(container, plan, snapshot, routeVersion);
    await settle(container, plan.migrationId, "rejected");
  } catch (rollbackError) {
    container.logger.error("[moveNote] rollback failed before route switch", {
      cause,
      rollbackError,
      migrationId: plan.migrationId,
    });
  }
}

async function settle(
  container: RequestContainer,
  migrationId: string,
  state: "completed" | "rejected",
): Promise<void> {
  const now = container.clock.now();
  await container.globalUnitOfWorkProvider.run((ctx) =>
    ctx.distributedOperationStore.markState(migrationId, state, now),
  );
}

async function resolveTargetOwner(
  container: RequestContainer,
  input: MoveNoteInput,
  actorUserId: UserId,
): Promise<NoteOwner> {
  if (input.targetOwnerType === "user") {
    return NoteOwner.user(actorUserId);
  }
  // The target is the requester's own choice, so its absence is reported
  // as itself rather than folded into the source's existence secrecy.
  const access = await resolveWorkspaceAccess({
    container,
    input: {
      workspaceId: input.targetWorkspaceId ?? "",
      userId: input.userId,
    },
  });
  if (access.role === null) {
    throw insufficientTargetRole();
  }
  WorkspaceAuthorization.ensureCan(access.role, "createNote");
  return NoteOwner.workspace(WorkspaceId.create(access.workspaceId));
}

async function membershipVersionOf(
  container: RequestContainer,
  scope: ScopeKey,
  actorUserId: UserId,
): Promise<number | null> {
  if (scope.type !== "workspace") {
    return null;
  }
  const membership = await container
    .workspaceReaderFor(scope)
    .membership.findByWorkspaceAndUser(scope.workspaceId, actorUserId);
  return membership === null ? null : (membership.expectedVersion as number);
}
