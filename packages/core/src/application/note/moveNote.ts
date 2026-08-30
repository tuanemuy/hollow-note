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
import {
  WorkspaceId,
  type WorkspaceRole,
} from "@repo/core/domain/workspace/valueObject";
import type { RequestContainer } from "../di/types";
import {
  ConflictError,
  isConflictError,
  NotFoundError,
  SystemError,
  SystemErrorCode,
} from "../errors";
import type { ScopeUnitOfWorkContext } from "../execution/unitOfWork";
import type {
  DistributedOperation,
  DistributedOperationPayload,
} from "../ports/distributedOperationStore";
import type { NoteRoute } from "../ports/noteRouteStore";
import { ScopeKey } from "../scope";
import {
  type MovedFileMetadata,
  relocateFilesCommandKey,
  relocateFilesForNote,
} from "../storage/relocateFilesForNote";
import type { ServiceArgs } from "../types";
import { resolveWorkspaceAccess } from "../workspace/resolveWorkspaceAccess";
import { noteAccessPolicy } from "./accessControl";
import { ownerOf } from "./view";

/**
 * Destination of a move. The workspace id belongs to the workspace member
 * alone: an id-less workspace target would otherwise reach
 * `WorkspaceId.create("")` and surface as `InvalidId`, which is not one of
 * the move's defined outcomes.
 */
export type MoveNoteTarget =
  | Readonly<{ targetOwnerType: "user" }>
  | Readonly<{ targetOwnerType: "workspace"; targetWorkspaceId: string }>;

export type MoveNoteInput = Readonly<{
  noteId: string;
  userId: string;
  /**
   * Version the caller saw, or `null` when it holds none — `getNote` does
   * not project one, so the transport boundary has nothing to send.
   * `null` skips the optimistic check.
   */
  expectedVersion: number | null;
}> &
  MoveNoteTarget;

export type MovedNoteView = Readonly<{
  noteId: string;
  ownerType: "user" | "workspace";
  ownerId: string;
  droppedTagNames: readonly string[];
  version: number;
}>;

/**
 * Seam for the tag half of a move.
 *
 * The tag domain does not exist yet, so this
 * slice ships the call sites and no implementation. The three members are
 * the same phases the note itself moves through: `plan` runs before the
 * operation is created, so its answer can be fixed into the operation
 * payload, and the names the move reports are read back from that payload
 * on every attempt — `plan` itself
 * is called once per *attempt*, and a resume discards what it returns, so
 * an implementation must be a pure read; `stageTarget` and `retireSource`
 * receive the unit of work of the phase they belong to, so an assignment
 * change commits with the note write that caused it.
 */
export interface NoteMoveTagRelocation {
  /**
   * Every applied-operation key `stageTarget` may write in the target
   * scope. An abort deletes the rows those keys assert, so it has to
   * clear them in the same transaction; declaring them here is what keeps
   * an implementation from leaving a receipt the resumed staging would
   * skip on (`abortBeforeSwitch`).
   */
  readonly targetScopeCommandKeys: readonly string[];
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

/** The seam's only implementation until the tag slice lands. */
export const noTagRelocation: NoteMoveTagRelocation = {
  targetScopeCommandKeys: [],
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

/**
 * The applied-operation keys the note half of this migration writes in
 * the *target* scope. An abort clears them together with the keys the tag
 * seam declares, because each one asserts that rows the abort is deleting
 * are in place — see `abortBeforeSwitch`.
 */
const TARGET_SCOPE_COMMANDS: readonly string[] = [
  STAGE_TARGET_COMMAND,
  relocateFilesCommandKey("stageTarget"),
  relocateFilesCommandKey("retireSource"),
];

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

const moveInProgress = (): ConflictError =>
  new ConflictError(
    "NOTE_MOVE_IN_PROGRESS",
    "Another move of this note is already running",
  );

/**
 * Input the move's state machine is fixed on. It is written into the
 * `distributed_operations` payload at creation and read back on every
 * resume, so a re-request never re-derives values that may have moved
 * since.
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

/**
 * A set of file metadata and what it weighs. The two always travel
 * together: whatever set a phase acts on is also the set its usage delta
 * is computed from, which is what keeps a credit and its later debit
 * describing the same rows.
 */
type MovedContents = Readonly<{
  files: readonly MovedFileMetadata[];
  bytes: number;
}>;

type MoveSnapshot = MovedContents &
  Readonly<{
    note: ActiveNote;
    revisions: readonly NoteRevision[];
  }>;

/** What the target actually holds once the staging phase is done. */
type StagedTarget = MovedContents & Readonly<{ version: number }>;

const totalBytes = (files: readonly MovedFileMetadata[]): number =>
  files.reduce((total, file) => total + file.size, 0);

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

const readScope = (raw: string): ScopeKey => {
  const scope = ScopeKey.parse(raw);
  if (scope === null) {
    throw corrupt(`payload carries an unreadable scope ${raw}`);
  }
  return scope;
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

/** What identifies the control row of one move, in full. */
type BeginMoveRequest = Readonly<{
  kind: "noteMove";
  partitionKey: string;
  requestKey: string;
  payload: DistributedOperationPayload;
}>;

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
  source: readScope(readString(payload, "source")),
  target: readScope(readString(payload, "target")),
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
 * The actor's Membership in one scope, read exactly once: the role an
 * authorization decision rests on and the version pinned for the
 * commit-time re-check must come from the *same* read. Read twice, a
 * demotion that
 * commits in between is pinned after the fact, and `ensurePinnedMembership`
 * — which compares versions, not roles — then confirms a role nobody
 * checked.
 */
type MembershipPin = Readonly<{
  role: WorkspaceRole | null;
  version: number | null;
}>;

/** A scope with no membership to pin: a personal scope, or a non-member. */
const NO_MEMBERSHIP: MembershipPin = { role: null, version: null };

async function pinActorMembership(
  container: RequestContainer,
  scope: ScopeKey,
  actorUserId: UserId,
): Promise<MembershipPin> {
  if (scope.type !== "workspace") {
    return NO_MEMBERSHIP;
  }
  const membership = await container
    .workspaceReaderFor(scope)
    .membership.findByWorkspaceAndUser(scope.workspaceId, actorUserId);
  return membership === null
    ? NO_MEMBERSHIP
    : {
        role: membership.entity.role,
        version: membership.expectedVersion as number,
      };
}

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
 * consulted — quota is enforced on intake only, and a move that overshoots
 * merely blocks the next upload.
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
 * Freezes the source side into a transferable snapshot and stages the
 * source half of the move authorization lock.
 *
 * Nothing is deleted here: the route still points at the source, so a
 * reader that arrives before the switch must still find the whole note.
 * Every leg that reaches this phase is still pre-switch, so the
 * authorization is re-asked unconditionally — a forward-only leg after
 * the switch never freezes a source again.
 *
 * The lock is staged inside this transaction, so from the moment the
 * freeze commits a workspace deletion and a mutation of the actor's own
 * membership both lose to the move rather than the other way round.
 */
async function snapshotSource(
  container: RequestContainer,
  plan: MovePlan,
): Promise<MoveSnapshot | null> {
  return container.scopeUnitOfWorkProvider.run(plan.source, async (ctx) => {
    await ctx.cleanupAdmission.assertWritable();
    await ctx.cleanupAdmission.assertActorWritable(plan.actorUserId);
    await ctx.workspaceOperationLockStore.assertWritable();
    await ensurePinnedMembership(
      ctx,
      plan.source,
      plan.actorUserId,
      plan.sourceMembershipVersion,
      // A member removed mid-move learns nothing about the note that is
      // no longer theirs.
      noteNotFound,
    );
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

    return { note, revisions, files, bytes: totalBytes(files) };
  });
}

/**
 * One target-local transaction,
 * which is what makes "the target admits this actor", "the target's move
 * lock stands" and "the target now holds the data" inseparable.
 * `note.moved` belongs to `retireSource`: nothing has changed hands until
 * the route switch, and a consumer that saw the event first would resolve
 * the note back to the source.
 *
 * What it answers is what the *target* holds, not what this attempt was
 * given. The two differ whenever the receipt already stands: an earlier
 * attempt staged a set that an upload to the source has since grown past,
 * and retiring the source on this attempt's snapshot would then delete
 * metadata that never crossed, leaving an R2 object no row names. The
 * note itself is the one thing that cannot be left behind that way — the
 * route names a single scope — so a stale staged copy is brought forward
 * instead (`adoptStagedCopy`).
 */
async function stageTarget(
  container: RequestContainer,
  plan: MovePlan,
  snapshot: MoveSnapshot,
  tagRelocation: NoteMoveTagRelocation,
): Promise<StagedTarget> {
  const now = container.clock.now();
  return container.scopeUnitOfWorkProvider.run(plan.target, async (ctx) => {
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
      const version = await adoptStagedCopy(ctx, plan, snapshot, now);
      const { files } = await relocateFilesForNote(ctx, {
        migrationId: plan.migrationId,
        phase: "snapshotSource",
        noteId: plan.noteId,
        owner: storageOwnerOf(plan.target),
        targetOwner: storageOwnerOf(plan.target),
        now,
      });
      return { version, files, bytes: totalBytes(files) };
    }

    const moved = Note.withOwner(snapshot.note, noteOwnerOf(plan.target), now);
    await ctx.noteRepository.insert(moved);
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
    return {
      version: moved.version,
      files: snapshot.files,
      bytes: snapshot.bytes,
    };
  });
}

/**
 * Takes over the copy an earlier attempt staged, bringing it up to the
 * version *this* attempt froze, and answers the version the target ends
 * up holding.
 *
 * The receipt makes the staging a no-op, but the source stayed writable
 * the whole time the route was `moving` — the move lock stops membership
 * changes and scope deletion, not edits — so an edit that landed between
 * the two attempts is in the snapshot and not in the staged copy. Since
 * `retireSource` deletes the source note and every revision it holds, a
 * copy left at the older version turns that edit into a silent loss the
 * instant the switch commits.
 *
 * Staleness of the note *row* is decidable without asking the source
 * twice: the staged copy is `Note.withOwner` of what was frozen, so its
 * version is exactly one past the frozen one, and an equal version means
 * nothing has been written to the source's note row since. The revisions
 * are not covered by that answer — a revision may be captured without the
 * note row moving — so they are re-synced on both branches rather than
 * hung on the version. Skipping them would leave the target short of a
 * revision `retireSource` then deletes from the source unconditionally.
 *
 * File metadata is deliberately *not* brought forward — a row that never
 * crossed stays with the source and is not retired either, which the note
 * cannot do because the route names a single scope.
 */
async function adoptStagedCopy(
  ctx: ScopeUnitOfWorkContext,
  plan: MovePlan,
  snapshot: MoveSnapshot,
  now: Date,
): Promise<number> {
  const staged = await ctx.noteRepository.findById(plan.noteId);
  if (staged === null) {
    throw corrupt("the staged note is gone but its receipt stands");
  }
  const refreshed = Note.withOwner(
    snapshot.note,
    noteOwnerOf(plan.target),
    now,
  );
  if (staged.entity.version !== refreshed.version) {
    await ctx.noteRepository.save(refreshed, staged.expectedVersion);
  }
  await ctx.noteRevisionRepository.deleteByNote(plan.noteId);
  for (const revision of snapshot.revisions) {
    await ctx.noteRevisionRepository.insert(revision);
  }
  await ctx.noteProjectionRevisionStore.bump(plan.noteId);
  return refreshed.version;
}

/**
 * Activates the target by releasing its move lock.
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
 * Retires the source rows and publishes `note.moved`.
 *
 * Forward-only: the route already points at the target, so this phase
 * asks no admission question it could be refused on. It is deduplicated
 * on the migration id instead, which is what lets a lost response replay
 * without debiting the source twice. Releasing the source's move lock
 * sits ahead of that guard for the same reason activation is unguarded.
 *
 * `retired` is the set the target actually took, so a row the source
 * gained after the staging keeps both its metadata and its object; the
 * debit is computed from the same set for the same reason. The note row
 * and its revisions go unconditionally instead, which is only safe
 * because `adoptStagedCopy` has already brought the staged copy up to the
 * version this attempt froze.
 *
 * The event is collected here rather than in the staging transaction
 * because this is the first transaction that runs *after* the switch —
 * the point where the change of ownership is real for a reader.
 */
async function retireSource(
  container: RequestContainer,
  plan: MovePlan,
  retired: MovedContents,
  previousOwner: NoteOwner,
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
      files: retired.files,
      now,
    });
    await applyStorageDelta(ctx, plan.source, -retired.bytes, -1, now);
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
          previousOwner,
          currentOwner: noteOwnerOf(plan.target),
          routeVersion: routeVersion + 1,
        },
        now,
      ),
    ]);
  });
}

/**
 * Thaws the route back to the source, and answers whether the
 * compensation may run at all.
 *
 * `abortMove` is a CAS on "still `moving` under *this* migration", which
 * is the only authority on the question the compensation depends on: the
 * staged rows are the note's sole copy from the instant the switch
 * commits, so they may be torn down only while the route still names the
 * source. Doing it first is what makes the answer trustworthy — read
 * afterwards, it would be a guess about a route the switch may have taken
 * in the meantime.
 *
 * A refusal and a lost response are indistinguishable from the caller's
 * side, so a failure is resolved by reading the route rather than
 * assumed: a route still parked on the source at the same generation is
 * safe to compensate whatever `abortMove` answered, and one that moved on
 * never is.
 *
 * *Who* holds that route is deliberately not part of the answer. A route
 * this thaw gave back and another migration has since claimed still names
 * the source, and what the compensation then reverses is identified by
 * this migration's own receipt (`abortBeforeSwitch`), so the rival's
 * staged copy is out of reach either way. Standing down instead would
 * strand this migration's own move locks and its operation — a permanent
 * stop where there was a recoverable one.
 */
async function thawRoute(
  container: RequestContainer,
  plan: MovePlan,
  routeVersion: number,
): Promise<boolean> {
  try {
    await container.noteRouteStore.abortMove({
      noteId: plan.noteId,
      migrationId: plan.migrationId,
      expectedRouteVersion: routeVersion,
    });
    return true;
  } catch {
    const route = await container.noteRouteStore.resolve(plan.noteId);
    return (
      route !== null &&
      route.routeVersion === routeVersion &&
      ScopeKey.equals(route.scope, plan.source)
    );
  }
}

/**
 * Runs one half of a compensation and answers what it threw instead of
 * propagating, so a half that has nothing to do with the failure still
 * runs. The caller decides which cause to raise once every half has had
 * its turn.
 */
async function runIndependently(
  half: () => Promise<unknown>,
): Promise<Readonly<{ cause: unknown }> | null> {
  try {
    await half();
    return null;
  } catch (cause) {
    return { cause };
  }
}

/**
 * The pre-switch abort, or `"switched"` when the switch turns out to have
 * landed and there is nothing left to compensate.
 *
 * Three things a complete reversal rests on, and none of them is optional.
 * The applied-operation keys go with the rows they assert — the note's own
 * and every key the tag seam declares — or a resumed `stageTarget` skips
 * into an empty target. What is torn down is identified by *this*
 * migration's `STAGE_TARGET_COMMAND` receipt and never by the mere
 * presence of a note row in the target — the abort is idempotent on the
 * migration id: the thaw hands the route back before
 * the teardown opens its transaction, so what the target holds by then may
 * be a rival migration's staged copy — the only party that may switch to
 * it or give it back — and deleting it loses the note the instant that
 * rival switches. Both move locks are released outside that check, because
 * an abort may follow a failure that never reached the staging it undoes.
 * And what it gives back is read from the target, never from the attempt's
 * snapshot: an attempt that failed before it froze the source must still
 * reverse whatever an *earlier* attempt of this same migration staged.
 *
 * The teardown and the two lock releases are three independent halves
 * rather than one sequence, and neither lock shares a transaction with the
 * teardown. A lock carries no lease and no expiry, only this migration
 * releases one, and the operation is settled `rejected` right after — so a
 * lock a failing teardown took with it is permanent, and it closes its
 * scope's deletion and membership management for good. Releasing the
 * target's before the teardown is safe for the same reason the teardown
 * needs no lock of its own: the thaw has already put the route back on the
 * source, so nothing reaches the staged copy through it either way.
 * Whatever failed is still what the caller is told about, since a
 * compensation never replaces a diagnosis; a lock failure the teardown's
 * cause outranks is logged rather than dropped, because it is the only
 * record of why a scope stopped accepting deletions.
 */
async function abortBeforeSwitch(
  container: RequestContainer,
  plan: MovePlan,
  routeVersion: number,
  tagRelocation: NoteMoveTagRelocation,
): Promise<"compensated" | "switched"> {
  if (!(await thawRoute(container, plan, routeVersion))) {
    return "switched";
  }
  const now = container.clock.now();
  const targetScopeCommands = [
    ...TARGET_SCOPE_COMMANDS,
    ...tagRelocation.targetScopeCommandKeys,
  ];
  const releaseMoveIn = (
    scope: ScopeKey,
  ): Promise<Readonly<{ cause: unknown }> | null> =>
    runIndependently(() =>
      container.scopeUnitOfWorkProvider.run(scope, (ctx) =>
        ctx.workspaceOperationLockStore.releaseMove(plan.migrationId),
      ),
    );
  const targetReleased = await releaseMoveIn(plan.target);
  const teardown = await runIndependently(() =>
    container.scopeUnitOfWorkProvider.run(plan.target, async (ctx) => {
      // The receipt commits with the rows it asserts, so it is the only
      // authority on "is what this scope holds mine?". `markApplied`
      // answering `true` means the key was not there — this migration
      // never staged — and the write it just made is undone by the clear
      // below.
      const stagedHere = !(await ctx.appliedOperationStore.markApplied({
        operationId: plan.migrationId,
        commandKey: STAGE_TARGET_COMMAND,
      }));
      for (const commandKey of targetScopeCommands) {
        await ctx.appliedOperationStore.clearApplied({
          operationId: plan.migrationId,
          commandKey,
        });
      }
      if (!stagedHere) {
        return;
      }
      const staged = await ctx.noteRepository.findById(plan.noteId);
      if (staged === null) {
        return;
      }
      await ctx.noteRepository.delete(plan.noteId, staged.expectedVersion);
      await ctx.noteRevisionRepository.deleteByNote(plan.noteId);
      const { files } = await relocateFilesForNote(ctx, {
        migrationId: plan.migrationId,
        phase: "snapshotSource",
        noteId: plan.noteId,
        owner: storageOwnerOf(plan.target),
        targetOwner: storageOwnerOf(plan.source),
        now,
      });
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
      await applyStorageDelta(ctx, plan.target, -totalBytes(files), -1, now);
    }),
  );
  const sourceReleased = await releaseMoveIn(plan.source);
  const failed = teardown ?? targetReleased ?? sourceReleased;
  const releases = [
    { scope: plan.target, result: targetReleased },
    { scope: plan.source, result: sourceReleased },
  ] as const;
  for (const { scope, result } of releases) {
    if (result !== null && result !== failed) {
      container.logger.error("[moveNote] a move lock was left standing", {
        cause: result.cause,
        migrationId: plan.migrationId,
        noteId: plan.noteId,
        scope: serializeScope(scope),
        source: serializeScope(plan.source),
        target: serializeScope(plan.target),
      });
    }
  }
  if (failed !== null) {
    throw failed.cause;
  }
  return "compensated";
}

/**
 * Claims the route for this migration.
 *
 * A route that moved between the pre-flight read and the claim is re-read
 * exactly once and the claim retried; a second conflict is answered rather
 * than looped on.
 *
 * Each read is checked against the plan's source before it is claimed.
 * `beginMove` compares only the route *version*, so a note that moved in
 * between would be claimed on its new route while every phase still
 * addresses the scope the payload froze — the freeze would then find
 * nothing and report `NOTE_NOT_FOUND` for what is really a lost race.
 * Refusing ahead of the claim is also what keeps the route from being
 * left `moving` by a claim nobody goes on to use.
 */
async function claimRoute(
  container: RequestContainer,
  plan: MovePlan,
): Promise<NoteRoute> {
  const readClaimable = async (): Promise<NoteRoute> => {
    const route = await container.noteRouteStore.resolve(plan.noteId);
    if (route === null) {
      throw noteNotFound();
    }
    if (!ScopeKey.equals(route.scope, plan.source)) {
      throw new ConflictError(
        "STALE_SCOPE_ROUTE",
        `The note left ${serializeScope(plan.source)} before the move could claim its route`,
      );
    }
    return route;
  };
  const claim = (route: NoteRoute): Promise<NoteRoute> =>
    container.noteRouteStore.beginMove({
      noteId: plan.noteId,
      expectedRouteVersion: route.routeVersion,
      target: plan.target,
      migrationId: plan.migrationId,
    });

  try {
    return await claim(await readClaimable());
  } catch (cause) {
    if (!isConflictError(cause) || cause.code !== "STALE_SCOPE_ROUTE") {
      throw cause;
    }
    return claim(await readClaimable());
  }
}

/**
 * Moves a note to another owner. The phase order, the abort rule and the
 * request key are fixed by the design; what follows is what the
 * implementation adds to them.
 *
 * The migration id is the `distributed_operations` row's id, so every
 * phase's `AppliedOperationStore` key resolves to the same command across
 * a replay — that is what makes a lost response converge instead of
 * duplicating the note, the revisions, the file metadata or the usage
 * delta. A request that is *not* the running operation's own is refused
 * (`ConflictError("NOTE_MOVE_IN_PROGRESS")`) rather than joined: the
 * store's join is a control-plane courtesy, and a saga that drives a plan
 * it did not author reverses phases it never ran.
 *
 * Authorization is guarded from two directions, and neither replaces the
 * other. Forwards: the pre-flight pass reads the actor's Membership once
 * per scope and pins the version of that same read, so each phase's
 * re-check inside its own transaction catches a removal or a demotion
 * that committed since. Backwards: each phase stages the move
 * authorization lock in its own scope, which is what makes a workspace
 * deletion or a mutation of the actor's membership attempted *after* that
 * phase lose to the move (`WORKSPACE_MOVE_IN_PROGRESS`) instead of racing
 * it.
 *
 * Two things this slice deliberately does not do. A failure after the
 * route switch leaves both scopes' move locks standing — the target's is
 * released only once the activation lands, the source's only once the
 * retirement does — and the operation `running`, which blocks either
 * scope's membership management, its deletion, and every later move of
 * this note until a recovery entry point exists — the failure
 * is logged with the migration id and both scopes so an operator can find
 * it. And the local / public note projections are not rebuilt for the new
 * owner: the target's generation counter is prepared, but no `note.moved`
 * subscriber exists yet.
 *
 * One piece of the freeze is **absent in this slice**: terminating the
 * source's unfinished jobs, because the Job aggregate does not exist.
 * The gap is recorded rather than papered over, the same way
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

  const sourcePin = await pinActorMembership(container, source, actorUserId);
  const access = noteAccessPolicy.evaluate(
    note,
    { kind: "user", userId: actorUserId, workspaceRole: sourcePin.role },
    { tokenHash: null, pass: null },
    container.clock.now(),
  );
  if (access.kind !== "granted" || !access.canEdit) {
    throw noteNotFound();
  }
  // The move UI is reachable from the detail view only, and the move is
  // defined on an active note; a trashed one is restored first.
  if (!Note.isActive(note)) {
    throw noteNotFound();
  }

  const { owner: targetOwner, pin: targetPin } = await resolveTargetOwner(
    container,
    input,
    actorUserId,
  );
  if (NoteOwner.equals(note.owner, targetOwner)) {
    return {
      noteId,
      ...ownerOf(note),
      droppedTagNames: [],
      version: note.version,
    };
  }

  NoteOwnershipPolicy.ensureMovable(note, access);
  if (
    input.expectedVersion !== null &&
    (stored.expectedVersion as number) !== input.expectedVersion
  ) {
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

  // What identifies *this* move: the note, who is moving it, where it is
  // going, and the route generation it starts from. A failed attempt
  // leaves the route version alone, so every retry of the same move
  // derives the same key and replays the same operation — while a move to
  // a target the note once lived in derives a different one, instead of
  // resuming a finished operation whose receipts would make the staging
  // skip into an empty target.
  //
  // The actor belongs in the key because the plan it replays is an
  // *authorization*: the pinned Membership versions, the move lock's
  // actor and the re-checks at commit time all name `plan.actorUserId`.
  // Without it a second member requesting the same move would resume the
  // first one's operation, and the checks that decide whether the move
  // may still commit would be asked about the wrong person.
  const requestKey = `${noteId}:${actorUserId}:${serializeScope(target)}:${route.routeVersion}`;
  const operation = await beginOperation(
    container,
    {
      kind: "noteMove",
      partitionKey: noteId,
      requestKey,
      payload: toPayload({
        noteId,
        actorUserId,
        source,
        target,
        sourceMembershipVersion: sourcePin.version,
        targetMembershipVersion: targetPin.version,
        droppedTagNames,
      }),
    },
    tagRelocation,
  );
  if (operation.requestKey !== requestKey) {
    throw moveInProgress();
  }
  const plan: MovePlan = {
    ...readPlan(operation.id, operation.payload),
    // Pinned per attempt rather than per operation: the pin detects a
    // membership that moved between *this* attempt's authorization and
    // the phase that commits it. Read back from the payload instead, a
    // move that failed once could never succeed again after any later
    // change to the actor's membership.
    sourceMembershipVersion: sourcePin.version,
    targetMembershipVersion: targetPin.version,
  };
  // Read the payload first: a row this attempt cannot decode is left as it
  // was found, rather than opened into a `running` nobody goes on to close.
  if (operation.state !== "running") {
    await reopen(container, plan.migrationId);
  }

  let routeVersion: number;
  try {
    ensurePlanMatchesRequest(plan, actorUserId, source, target);
    // Every phase addresses the two scopes separately — the freeze reads
    // one and the staging inserts into the other — so a migration whose
    // scopes coincide would have `stageTarget` insert over the row
    // `snapshotSource` just read, and the abort delete the only copy.
    if (ScopeKey.equals(plan.source, plan.target)) {
      throw corrupt("the route scope and the target are the same scope");
    }
    routeVersion = (await claimRoute(container, plan)).routeVersion;
  } catch (cause) {
    // This attempt staged nothing, but an earlier one under the same
    // migration may have — and a claim whose response was lost, or an
    // operation left `running`, would block every later move of this note.
    if (
      (await releaseUnusedClaim(container, plan, tagRelocation)) === "switched"
    ) {
      logStuckAfterSwitch(container, plan, cause);
    } else {
      await settleQuietly(container, plan, "rejected", cause);
    }
    throw cause;
  }

  let staged: StagedTarget;
  let previousOwner: NoteOwner;
  try {
    const observed = await snapshotSource(container, plan);
    if (observed === null) {
      throw noteNotFound();
    }
    staged = await stageTarget(container, plan, observed, tagRelocation);
    await container.noteRouteStore.switchMove({
      noteId,
      migrationId: plan.migrationId,
      expectedRouteVersion: routeVersion,
    });
    previousOwner = observed.note.owner;
  } catch (cause) {
    await rollBack(container, plan, routeVersion, cause, tagRelocation);
    throw cause;
  }

  try {
    await activateTarget(container, plan);
    await retireSource(
      container,
      plan,
      staged,
      previousOwner,
      routeVersion,
      tagRelocation,
    );
  } catch (cause) {
    logStuckAfterSwitch(container, plan, cause);
    throw cause;
  }
  // Everything the caller asked for has committed; closing the control row
  // is bookkeeping. Reported as a failure it would be a lie the caller
  // cannot act on — a re-request joins the still-`running` operation and
  // is refused with `NOTE_MOVE_IN_PROGRESS`.
  await settleQuietly(container, plan, "completed", null);

  return {
    noteId,
    ...ownerOf({ ...note, owner: noteOwnerOf(plan.target) }),
    droppedTagNames: plan.droppedTagNames,
    version: staged.version,
  };
}

/**
 * Forward-only from here, and nothing drives the retry yet: the note
 * already belongs to the target, while the source keeps its rows and its
 * move lock. Logged with both scopes because that lock is what stops the
 * source's membership management and its deletion.
 */
function logStuckAfterSwitch(
  container: RequestContainer,
  plan: MovePlan,
  cause: unknown,
): void {
  container.logger.error("[moveNote] stuck after the route switch", {
    cause,
    migrationId: plan.migrationId,
    noteId: plan.noteId,
    source: serializeScope(plan.source),
    target: serializeScope(plan.target),
  });
}

/**
 * The operation is this request's own (its key says so), so its plan must
 * describe the same journey — the same two scopes and the same actor,
 * since every phase re-checks the authorization of `plan.actorUserId`. A
 * mismatch is a corrupt payload, not a race.
 */
function ensurePlanMatchesRequest(
  plan: MovePlan,
  actorUserId: UserId,
  source: ScopeKey,
  target: ScopeKey,
): void {
  if (
    !ScopeKey.equals(plan.source, source) ||
    !ScopeKey.equals(plan.target, target)
  ) {
    throw corrupt("the resumed operation moves a different pair of scopes");
  }
  if (plan.actorUserId !== actorUserId) {
    throw corrupt("the resumed operation belongs to a different actor");
  }
}

/**
 * Compensation boundary. The original failure is what the caller must
 * see, so a failing rollback is logged and swallowed — leaving a route
 * stuck in `moving` is recoverable, replacing the diagnosis is not.
 *
 * A rollback that finds the switch already landed is not a failure: the
 * request lost its response after the move became real, so the abort
 * stands down, and what it leaves is the state any post-switch failure
 * leaves — *including* the operation, which stays `running`. Neither
 * `activateTarget` nor `retireSource` ran, so both scopes still hold a
 * move lock, and those carry no lease and no expiry: only a caller
 * holding this migration id releases one. Settling here would make
 * `beginOrResume` mint a new migration for the next request, so no such
 * caller could ever exist again and both workspaces would lose deletion
 * and membership management for good. The same physical state reached
 * through the post-switch catch is left `running` for that reason.
 *
 * Before the switch the trade runs the other way and the operation is
 * settled `rejected`: a route stuck in `moving` only stops this note,
 * while an operation stuck in `running` makes every later move of it
 * refuse to start (the store would join the new request to this dead one).
 */
async function rollBack(
  container: RequestContainer,
  plan: MovePlan,
  routeVersion: number,
  cause: unknown,
  tagRelocation: NoteMoveTagRelocation,
): Promise<void> {
  try {
    if (
      (await abortBeforeSwitch(
        container,
        plan,
        routeVersion,
        tagRelocation,
      )) === "switched"
    ) {
      logStuckAfterSwitch(container, plan, cause);
      return;
    }
  } catch (rollbackError) {
    container.logger.error("[moveNote] rollback failed before route switch", {
      cause,
      rollbackError,
      migrationId: plan.migrationId,
    });
  }
  await settleQuietly(container, plan, "rejected", cause);
}

/**
 * Gives back a route this attempt may hold without knowing it does:
 * `beginMove` can commit and lose its response, and the operation is
 * about to be settled `rejected`, so nobody would ever drive that claim
 * again — every later move of the note would be refused
 * (`NOTE_ROUTE_STATE_VIOLATION`). The claim is identified by the
 * migration id, so a route claimed by somebody else is left alone.
 *
 * On a *first* attempt nothing is staged and giving the route back is the
 * whole repair. A resumed attempt is why that cannot be the whole of it:
 * it inherits the staged copy, its credit, its receipts and both scopes'
 * move locks from the attempt before, and those locks carry no lease and
 * no owner but this saga. Handing the route back while they stand is a
 * permanent stop, not a leftover — the user's next choice of destination
 * advances `routeVersion`, the `requestKey` that could resume this
 * migration stops being derivable, and both workspaces lose deletion and
 * membership management for good. So the release runs the same
 * compensation the pre-switch abort does, which reverses what the target
 * actually holds rather than what this attempt observed.
 *
 * Releasing is a repair, and the read that decides whether to release is
 * part of it: the route store is the very thing that just failed, so both
 * halves are expected to fail together. Neither may replace the caller's
 * diagnosis, and neither may keep the operation from being settled — left
 * `running`, it would refuse every later move of this note instead of
 * merely leaving a route parked. A repair that could not read the route at
 * all therefore falls on the *closing* side, unlike the repair in
 * `rejectLostOperation`: what reached this catch is a claim attempt, so
 * this request is the party that would have created anything worth
 * keeping open, and a `running` row here blocks every later move.
 *
 * `"switched"` is the one answer that forbids closing. A concurrent
 * request deriving the identical key claims the same migration
 * (`beginMove` is idempotent on the migration id), so the route may have
 * been switched by that twin between this claim's failure and the read
 * below — and then nothing was compensated, both scopes still hold their
 * move locks, and settling would remove the only party that can release
 * them. The stop is recorded and left `running` instead, exactly as
 * `rollBack` and `rejectLostOperation` do with the same answer.
 */
async function releaseUnusedClaim(
  container: RequestContainer,
  plan: MovePlan,
  tagRelocation: NoteMoveTagRelocation,
): Promise<"released" | "switched"> {
  try {
    const route = await container.noteRouteStore.resolve(plan.noteId);
    if (
      route === null ||
      route.state !== "moving" ||
      route.migrationId !== plan.migrationId
    ) {
      return "released";
    }
    return (await abortBeforeSwitch(
      container,
      plan,
      route.routeVersion,
      tagRelocation,
    )) === "switched"
      ? "switched"
      : "released";
  } catch (releaseError) {
    container.logger.error("[moveNote] the claimed route was left moving", {
      releaseError,
      migrationId: plan.migrationId,
      noteId: plan.noteId,
    });
    return "released";
  }
}

/**
 * Opens the control row — and closes it again when the answer to that
 * opening is lost.
 *
 * A lost response is not a lost write. The row may well have committed,
 * `running`, while no one in this process knows its id. `beginOrResume`
 * joins every later request for this note to that row, so from here on
 * every move of it is refused (`NOTE_MOVE_IN_PROGRESS`) for everyone
 * except a request deriving the very same key — and the moment the user
 * picks another destination even that key is gone. Every switch-less end
 * of the saga is settled `rejected` for exactly this reason.
 *
 * The id is the only thing the loss took, and the request key derives it
 * again: the call is idempotent on that key, so re-issuing the identical
 * request returns the committed row, or creates the one that never
 * committed.
 *
 * What comes back is *not* necessarily a row that holds nothing, which is
 * the premise a compensation-free close would rest on. The key is idempotent on
 * state as well, and a failed attempt leaves `routeVersion` alone, so the
 * same key is derivable — and returns the same row — while an earlier
 * attempt's claim, both scopes' move locks and a staged copy are still
 * standing, or while a concurrent request for the identical move is
 * driving them. Closing such a row settles the only party that could ever
 * release those locks. So the route decides which row of the terminal
 * table this is: a claim still held under this operation is given back
 * through the pre-switch compensation before the row is closed, a route
 * that already names the destination is a post-switch stop and is left
 * `running`, and only a row holding nothing is settled outright.
 *
 * Only a row this request authored may be closed. A different
 * `requestKey` means the store joined us to an operation somebody else
 * drives, and a terminal row is already closed. Like the other
 * compensations here, the repair — the re-issue and the route read that
 * decide it as much as the settle — is logged and swallowed rather than
 * allowed to replace the caller's diagnosis; a repair that fails leaves
 * the row `running` with its claim, which is recoverable, rather than
 * terminal with it, which is not.
 */
async function beginOperation(
  container: RequestContainer,
  request: BeginMoveRequest,
  tagRelocation: NoteMoveTagRelocation,
): Promise<DistributedOperation> {
  try {
    const { operation } = await container.globalUnitOfWorkProvider.run((ctx) =>
      ctx.distributedOperationStore.beginOrResume(request),
    );
    return operation;
  } catch (cause) {
    await rejectLostOperation(container, request, tagRelocation, cause);
    throw cause;
  }
}

async function rejectLostOperation(
  container: RequestContainer,
  request: BeginMoveRequest,
  tagRelocation: NoteMoveTagRelocation,
  cause: unknown,
): Promise<void> {
  try {
    const { operation } = await container.globalUnitOfWorkProvider.run((ctx) =>
      ctx.distributedOperationStore.beginOrResume(request),
    );
    if (
      operation.requestKey !== request.requestKey ||
      operation.state !== "running"
    ) {
      return;
    }
    const plan = readPlan(operation.id, operation.payload);
    const route = await container.noteRouteStore.resolve(plan.noteId);
    if (route !== null && ScopeKey.equals(route.scope, plan.target)) {
      logStuckAfterSwitch(container, plan, cause);
      return;
    }
    if (
      route !== null &&
      route.state === "moving" &&
      route.migrationId === plan.migrationId &&
      (await abortBeforeSwitch(
        container,
        plan,
        route.routeVersion,
        tagRelocation,
      )) === "switched"
    ) {
      logStuckAfterSwitch(container, plan, cause);
      return;
    }
    await settle(container, operation.id, "rejected");
  } catch (repairError) {
    container.logger.error("[moveNote] the opened operation was left running", {
      cause,
      repairError,
      noteId: request.partitionKey,
      requestKey: request.requestKey,
    });
  }
}

/**
 * Settling is bookkeeping on the control row, so its own failure never
 * replaces what the caller was owed — the diagnosis of the failure that
 * led here, or the view of a move that has already committed. `cause` is
 * `null` on that second path.
 */
async function settleQuietly(
  container: RequestContainer,
  plan: MovePlan,
  state: "completed" | "rejected",
  cause: unknown,
): Promise<void> {
  try {
    await settle(container, plan.migrationId, state);
  } catch (settleError) {
    container.logger.error("[moveNote] the operation was left running", {
      cause,
      settleError,
      migrationId: plan.migrationId,
    });
  }
}

/**
 * Puts a replayed terminal row back where the terminal table expects the
 * saga to start. `beginOrResume` is idempotent on the `requestKey` and
 * replays the row that key names *whatever state it is in*, and a failed
 * attempt settled `rejected` leaves `routeVersion` alone — so a retry of
 * the same move is handed a terminal row. The saga must not run on one: a
 * stop after the route switch only logs, so the row would stay terminal
 * while both scopes keep a move lock that carries no lease and that only a
 * caller holding this migration id can release. No such caller could exist
 * again (a re-request lands on the target and returns the no-op success),
 * and both workspaces would lose deletion and membership management for
 * good.
 *
 * Unlike the settles around it this one is *not* swallowed: leaving the
 * row terminal is the very thing it exists to prevent, so an attempt that
 * cannot reopen must not go on to take the route and the two move locks.
 * Failing here costs nothing the next retry cannot redo — no phase has run
 * yet, and whatever an earlier attempt left behind stays reachable under
 * the same `requestKey`.
 *
 * The store refuses the reopen while another move of this note runs: our
 * row went terminal, and while it was, a different request key was free to
 * start its own. That is the same answer `beginOrResume` gives when it
 * joins a request to somebody else's operation, so it is reported the same
 * way.
 */
async function reopen(
  container: RequestContainer,
  migrationId: string,
): Promise<void> {
  try {
    await container.globalUnitOfWorkProvider.run((ctx) =>
      ctx.distributedOperationStore.markState(
        migrationId,
        "running",
        container.clock.now(),
      ),
    );
  } catch (cause) {
    if (
      isConflictError(cause) &&
      cause.code === "DISTRIBUTED_OPERATION_ALREADY_RUNNING"
    ) {
      throw moveInProgress();
    }
    throw cause;
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

/**
 * Decides the destination and pins the Membership that decision
 * rests on. `NoteOwnershipPolicy.ensureMovable` judges the source side and
 * takes this answer as given, since the target's refusal is a
 * workspace-role verdict (`InsufficientRole`) the note domain cannot
 * reach.
 *
 * The verdict is read from the pin rather than from `resolveWorkspaceAccess`,
 * whose role comes from an earlier round trip: the version a later phase
 * re-checks has to belong to the very read that granted the permission.
 */
async function resolveTargetOwner(
  container: RequestContainer,
  input: MoveNoteInput,
  actorUserId: UserId,
): Promise<Readonly<{ owner: NoteOwner; pin: MembershipPin }>> {
  if (input.targetOwnerType === "user") {
    return { owner: NoteOwner.user(actorUserId), pin: NO_MEMBERSHIP };
  }
  // The target is the requester's own choice, so its absence is reported
  // as itself rather than folded into the source's existence secrecy.
  const access = await resolveWorkspaceAccess({
    container,
    input: {
      workspaceId: input.targetWorkspaceId,
      userId: input.userId,
    },
  });
  const workspaceId = WorkspaceId.create(access.workspaceId);
  const pin = await pinActorMembership(
    container,
    ScopeKey.workspace(workspaceId),
    actorUserId,
  );
  if (pin.role === null) {
    throw insufficientTargetRole();
  }
  WorkspaceAuthorization.ensureCan(pin.role, "createNote");
  return { owner: NoteOwner.workspace(workspaceId), pin };
}
