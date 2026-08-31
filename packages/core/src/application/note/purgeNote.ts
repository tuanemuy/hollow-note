import type { ExpectedVersion } from "@repo/core/domain/common/transactionalRepository";
import type { UserId } from "@repo/core/domain/identity/valueObject";
import { NoteEvents } from "@repo/core/domain/note/events";
import { Note } from "@repo/core/domain/note/note";
import type { NoteOwner } from "@repo/core/domain/note/valueObject";
import { NoteId } from "@repo/core/domain/note/valueObject";
import type { StoredFileId } from "@repo/core/domain/storage/valueObject";
import type { NotePurgeContainer, RequestContainer } from "../di/types";
import {
  ConflictError,
  isConflictError,
  isNotFoundError,
  isValidationError,
  ValidationError,
} from "../errors";
import type { ScopeUnitOfWorkContext } from "../execution/unitOfWork";
import type { NoteRoute } from "../ports/noteRouteStore";
import { ScopeKey } from "../scope";
import type { ServiceArgs } from "../types";
import {
  claimNoteForDelete,
  ensureExpectedVersion,
  noteNotFound,
  resolveDeletableNote,
  scopeOfOwner,
} from "./editing";

/**
 * Who asked for the purge, which is what decides *which* checks apply.
 *
 * `userRequest` is the screen's path and carries the full gate: the
 * viewer's `canDelete`, the trash barrier, and the note's version.
 * `scopeCleanup` is the internal path a scope-wide deletion drives —
 * the owning user is already `deleting`, the workspace and its
 * memberships may be gone, and an active note is a legitimate target —
 * so it authenticates on the cleanup operation instead and keeps only
 * the two checks that stay meaningful: the note really belongs to the
 * scope being cleaned, and it is the version the enumeration saw.
 *
 * `retention` is the trash's own expiry sweep. It has neither of the
 * other two principals: nobody asked for it, so there is no viewer to
 * evaluate `canDelete` against, and no deletion is under way, so
 * `assertOwner` would refuse it. What is left is exactly what the
 * enumeration already established — this note is in this scope, at this
 * version — and the version is what makes it safe to keep so little: a
 * note restored between `listPurgeable` and the transaction has moved
 * on from the version the sweep read, and is refused as a conflict.
 */
export type PurgeNoteInput =
  | Readonly<{
      kind: "userRequest";
      noteId: string;
      userId: string;
      expectedVersion: number;
    }>
  | Readonly<{
      kind: "scopeCleanup";
      noteId: string;
      expectedVersion: number;
      /**
       * Scope the cleanup is walking. **Internal only** — a caller who
       * could name a scope would be able to purge a note out of a
       * context the route does not place it in.
       */
      scope: ScopeKey;
      deletionOperationId: string;
    }>
  | Readonly<{
      kind: "retention";
      noteId: string;
      expectedVersion: number;
      /** Scope whose trash is being swept. **Internal only**, as above. */
      scope: ScopeKey;
    }>;

/**
 * The two admissions that name no actor.
 *
 * Both are reachable from either plane, which is what
 * {@link purgeNoteInternally} exists to express: their gates read the
 * route and the scope's own rows, never the request-path viewer
 * resolution `userRequest` opens with.
 */
export type InternalPurgeNoteInput = Extract<
  PurgeNoteInput,
  { kind: "scopeCleanup" | "retention" }
>;

/** How long a completed purge's route stays reachable as a tombstone. */
export const PURGE_TOMBSTONE_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Route generation handed to `beginPurge` when the claim is being
 * *resumed* rather than taken.
 *
 * `beginPurge` answers a route already `purging` under the same
 * operation before it compares generations — a contractual order, held
 * by every backend through `describeNoteRouteStoreContract` — so a
 * value no route can carry is what turns the claim into the read that
 * recovery needs: the port hides `purging` rows from `resolve`, and
 * this is the only way back to the scope and the generation a stopped
 * purge was working on. A route that is *not* ours refuses the claim on
 * its state or its generation, so the sentinel can never take one.
 */
const RESUME_CLAIM = -1;

const NOTE_NOT_TRASHED = "NOTE_NOT_TRASHED";

const noteNotTrashed = (): ValidationError =>
  new ValidationError(NOTE_NOT_TRASHED, "The note is not in the trash");

/**
 * Whether a failed local transaction is one of the refusals step 3
 * lets hand the route back.
 *
 * The set is closed on purpose, and it is exactly what `reclaim` can
 * raise while the note is still there: the permission collapse
 * (`NOTE_NOT_FOUND`), the trash barrier, the version, the foreign
 * scope, the lost cleanup ownership. Every one of them means the
 * transaction decided *not* to delete, so the note it refused to touch
 * has to become reachable again.
 *
 * Anything else — a driver fault, a lost response — says nothing about
 * whether the delete committed, and a commit whose response was lost is
 * the case that makes this a whitelist rather than a `catch`: aborting
 * there would reopen the route of a note that is already gone and whose
 * `note.purged` is already in the outbox, leaving a row that resolves to
 * nothing for as long as it stands.
 */
const isAbortableRefusal = (cause: unknown): boolean =>
  isConflictError(cause) ||
  isNotFoundError(cause) ||
  (isValidationError(cause) && cause.code === NOTE_NOT_TRASHED);

const versionConflict = (): ConflictError =>
  new ConflictError(
    "OPTIMISTIC_LOCK_FAILURE",
    "The note changed since it was read",
  );

const foreignScope = (): ConflictError =>
  new ConflictError(
    "STALE_SCOPE_ROUTE",
    "The note does not live in the scope being cleaned up",
  );

/**
 * What the purge's state machine is fixed on, decided once during
 * admission and never re-derived. A resume reads it back from the route
 * and the cleanup's own input instead of asking the requester again —
 * the requester may be gone by then, and the note certainly is.
 */
type PurgePlan = Readonly<{
  operationId: string;
  noteId: NoteId;
  scope: ScopeKey;
  routeVersion: number;
  expectedVersion: number;
  /** `null` on the cleanup path, which has no actor to re-check. */
  actorUserId: UserId | null;
  /** `null` on the user path; the event carries it either way. */
  deletionOperationId: string | null;
}>;

/**
 * What the local transaction settled. `alreadyPurged` is the forward
 * half of recovery: the delete committed on an earlier attempt whose
 * response was lost, so `note.purged` is already in the outbox and this
 * attempt owes only the global phases.
 */
type LocalOutcome = Readonly<{
  kind: "purged" | "alreadyPurged";
  projectionRevision: number;
}>;

const hex = (bytes: ArrayBuffer): string =>
  Array.from(new Uint8Array(bytes))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

/**
 * The internal operation id of a purge driven by a scope-wide deletion.
 *
 * Derived rather than minted so that a redelivered cleanup command
 * resumes the purge it already started instead of racing a second one
 * against it: at-least-once delivery is the normal case here, and the
 * route is the only place a purge's identity is recorded.
 */
export async function ownerPurgeOperationId(
  deletionOperationId: string,
  noteId: NoteId,
): Promise<string> {
  return digest(`ownerPurge:${deletionOperationId}:${noteId}`);
}

/**
 * The internal operation id of a purge driven by the retention sweep.
 *
 * Derived from the note alone, because the note is the whole identity
 * here: the sweep has no operation of its own, its turns are replayed
 * freely, and two turns that overlap on one note must resume a single
 * purge rather than race two.
 */
export async function retentionPurgeOperationId(
  noteId: NoteId,
): Promise<string> {
  return digest(`trashExpiry:${noteId}`);
}

const digest = async (source: string): Promise<string> =>
  hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(source)));

/**
 * Completely deletes a note (UC-note-019, ED-10).
 *
 * The purge is a saga over three stores that cannot share a
 * transaction — the global route, the scope's own data, and the global
 * public projection — and its whole design is the order they are
 * touched in.
 *
 * The route is claimed first (`beginPurge`), which closes every external
 * read and mutation of the note before anything is destroyed. A *refusal*
 * the re-check inside that transaction raises — a note restored between
 * the entry gate and the claim, a member removed, a version that moved —
 * hands the route back (`abortPurge`) and reports itself unchanged,
 * because a refusal is a decision not to delete and the note it left
 * behind has to be reachable again ({@link isAbortableRefusal}).
 *
 * Any *other* failure of that transaction is not a decision, and the
 * route stays `purging`. Whether the delete committed is unknown from
 * out here — a lost response to a committed delete looks exactly like
 * one that never ran — and only one of the two answers is recoverable:
 * a route left `purging` is resumed by re-issuing the same command,
 * while a route reopened over a note that is already gone resolves
 * forever to nothing. From the moment the delete commits the saga is
 * forward-only in any case: the note's sole copy is gone, so there is
 * nothing to give a reopened route back to, and a failure is retried
 * rather than compensated.
 *
 * The public projection is removed before the route is tombstoned, never
 * after. The tombstone is what tells a later reader that this note is
 * finished with, and publishing that while a public row still stands
 * would leave the row with nothing left to remove it.
 *
 * The fan-out — tag assignments, stored files, backup records, the read
 * model, the usage counters — rides on `note.purged` and is settled by
 * its subscribers, at-least-once and out of order (ADR 008). Collecting
 * that event in the same transaction as the delete is what makes the
 * hand-off atomic.
 *
 * **Not covered by this slice**: the recovery driver. A purge whose
 * process dies mid-saga is resumed by re-issuing the same command — the
 * cleanup path derives its operation id and therefore converges — but
 * nothing scans for stopped operations on its own, and a `userRequest`
 * purge whose response was lost cannot be re-issued at all: its
 * operation id was minted, and `NoteRouteStore.resolve` hides the
 * `purging` route that holds it. That is the whole cost of leaving an
 * undecided transaction's route `purging`: on the two internal paths a
 * redelivery resumes it, and on the user path it waits for that driver
 * instead of being reopened over a note that may already be gone.
 */
export async function purgeNote({
  container,
  input,
}: ServiceArgs<PurgeNoteInput>): Promise<void> {
  if (input.kind !== "userRequest") {
    return purgeNoteInternally({ container, input });
  }
  return drive(container, await admitUserRequest(container, input));
}

export type PurgeNoteInternallyArgs = Readonly<{
  container: NotePurgeContainer;
  input: InternalPurgeNoteInput;
}>;

/**
 * The same purge, reached by the two admissions that name no actor
 * (UC-note-020 / UC-note-021 / UC-note-022).
 *
 * The whole of the request path that this drops is the viewer
 * resolution `userRequest` opens with — the scope router, the note
 * reader, the workspace reader. What is left is the saga itself, over
 * ports both containers carry, which is what lets the deletion cleanup
 * and the retention sweep purge from the worker plane instead of
 * needing a request to ride on.
 */
export async function purgeNoteInternally({
  container,
  input,
}: PurgeNoteInternallyArgs): Promise<void> {
  const plan = await admitInternal(container, input);
  if (plan === null) {
    return;
  }
  return drive(container, plan);
}

async function drive(
  container: NotePurgeContainer,
  plan: PurgePlan,
): Promise<void> {
  let outcome: LocalOutcome;
  try {
    outcome = await deleteLocally(container, plan);
  } catch (cause) {
    if (isAbortableRefusal(cause)) {
      await abortQuietly(container, plan, cause);
    } else {
      container.logger.error(
        "[purgeNote] the local transaction failed without deciding; the route is left purging",
        {
          cause,
          operationId: plan.operationId,
          noteId: plan.noteId,
          scope: ScopeKey.serialize(plan.scope),
        },
      );
    }
    throw cause;
  }

  try {
    await container.publicNoteProjectionWriter.removeForPurge({
      noteId: plan.noteId,
      operationId: plan.operationId,
      routeVersion: plan.routeVersion,
      projectionRevision: outcome.projectionRevision,
    });
    await container.noteRouteStore.finishPurge({
      noteId: plan.noteId,
      operationId: plan.operationId,
      expiresAt: new Date(container.clock.now().getTime() + PURGE_TOMBSTONE_MS),
    });
  } catch (cause) {
    // Forward-only from here: the note is already gone, so the route is
    // left `purging` — unreachable, which is the truth — until the same
    // command is re-issued.
    container.logger.error("[purgeNote] stuck after the local delete", {
      cause,
      operationId: plan.operationId,
      noteId: plan.noteId,
      scope: ScopeKey.serialize(plan.scope),
    });
    throw cause;
  }
}

async function admitUserRequest(
  container: RequestContainer,
  input: Extract<PurgeNoteInput, { kind: "userRequest" }>,
): Promise<PurgePlan> {
  const { noteId, actorUserId, scope, routeVersion, note } =
    await resolveDeletableNote(container, input);
  // The trash is the only entrance: an active note reaches this call
  // from a stale screen, and telling it so is what lets it re-read.
  if (!Note.isTrashed(note)) {
    throw noteNotTrashed();
  }
  // The aggregate's own version, not an OCC token: this read happens
  // outside the transaction that deletes, so nothing here can consume a
  // token. The token comparison is `ensureExpectedVersion` inside that
  // transaction, and that is the one that decides.
  if (note.version !== input.expectedVersion) {
    throw versionConflict();
  }

  const plan: PurgePlan = {
    // Minted, not derived: a user purge has no enclosing operation to
    // hang an identity off, and two requesters racing on one note must
    // claim the route as two rivals rather than as one saga.
    operationId: container.idGenerator.next(),
    noteId,
    scope,
    routeVersion,
    expectedVersion: input.expectedVersion,
    actorUserId,
    deletionOperationId: null,
  };
  await claimRoute(container, plan);
  return plan;
}

/**
 * Step 1 and step 2 for an admission that names no actor: decide
 * whether this command may purge, then claim the route for it. `null`
 * means the purge is already finished and this command is a duplicate.
 *
 * The two kinds diverge on their identity and on their barrier only.
 * A cleanup derives its operation id from the deletion that ordered it
 * and has to prove it still owns the scope; retention derives its own
 * from the note and has no barrier to prove anything against. Both are
 * left with the same two claims the enumeration already made — the note
 * lives in this scope, at this version — which the route check here and
 * the re-check inside the transaction take between them.
 */
async function admitInternal(
  container: NotePurgeContainer,
  input: InternalPurgeNoteInput,
): Promise<PurgePlan | null> {
  const noteId = NoteId.create(input.noteId);
  const deletionOperationId =
    input.kind === "scopeCleanup" ? input.deletionOperationId : null;
  const operationId =
    deletionOperationId === null
      ? await retentionPurgeOperationId(noteId)
      : await ownerPurgeOperationId(deletionOperationId, noteId);
  const route = await container.noteRouteStore.resolve(noteId);
  if (route === null) {
    return resumeInternal(container, input, {
      noteId,
      operationId,
      deletionOperationId,
    });
  }
  // The purge already ran to completion and the tombstone has not
  // expired yet. Cleanup commands are delivered at least once, so this
  // is the ordinary duplicate, not a failure to report.
  if (route.state === "tombstone") {
    return null;
  }
  if (!ScopeKey.equals(route.scope, input.scope)) {
    throw foreignScope();
  }

  const plan: PurgePlan = {
    operationId,
    noteId,
    scope: input.scope,
    routeVersion: route.routeVersion,
    expectedVersion: input.expectedVersion,
    actorUserId: null,
    deletionOperationId,
  };
  if (deletionOperationId !== null) {
    // Ownership of the cleanup is asked before the route is closed: a
    // command from an operation that no longer owns this scope must not
    // be able to make the note unreachable even for the moment an abort
    // would take to undo.
    await container.scopeUnitOfWorkProvider.run(input.scope, (ctx) =>
      ctx.cleanupAdmission.assertOwner(deletionOperationId),
    );
  }
  await claimRoute(container, plan);
  return plan;
}

/**
 * Picks up an internal purge whose route no longer resolves.
 *
 * The claim is the read: a row still `purging` under this same
 * operation comes back — the delete, the public removal or the tombstone
 * was lost — and the saga carries on from there.
 *
 * `null` means the note is gone and this command has nothing left to do.
 * That is the *only* thing the absence of a row proves, so it is the
 * only refusal folded into it. A `ConflictError` — a route somebody
 * else's operation holds, a creation still `reserved`, a tombstone whose
 * expiry has passed — says nothing about whether this scope's note was
 * destroyed, and a caller that counts the calls which did not throw
 * (`deleteNotesForOwner`) would read it as "already purged" and
 * acknowledge a deletion over a note that is still there.
 */
async function resumeInternal(
  container: NotePurgeContainer,
  input: InternalPurgeNoteInput,
  identity: Readonly<{
    noteId: NoteId;
    operationId: string;
    deletionOperationId: string | null;
  }>,
): Promise<PurgePlan | null> {
  const { noteId, operationId, deletionOperationId } = identity;
  let claimed: NoteRoute;
  try {
    claimed = await container.noteRouteStore.beginPurge({
      noteId,
      scope: input.scope,
      expectedRouteVersion: RESUME_CLAIM,
      operationId,
    });
  } catch (cause) {
    if (isNotFoundError(cause)) {
      return null;
    }
    throw cause;
  }
  if (!ScopeKey.equals(claimed.scope, input.scope)) {
    throw foreignScope();
  }
  return {
    operationId,
    noteId,
    scope: claimed.scope,
    routeVersion: claimed.routeVersion,
    expectedVersion: input.expectedVersion,
    actorUserId: null,
    deletionOperationId,
  };
}

/**
 * Closes the note to the outside world.
 *
 * A route that refuses the claim is reported as `NOTE_NOT_FOUND` rather
 * than as the conflict it is: whichever rival holds it — a second purge,
 * a move — the note this request read is on its way out of the caller's
 * reach, and a conflict would invite a retry that can only fail again.
 */
async function claimRoute(
  container: NotePurgeContainer,
  plan: PurgePlan,
): Promise<void> {
  try {
    await container.noteRouteStore.beginPurge({
      noteId: plan.noteId,
      scope: plan.scope,
      expectedRouteVersion: plan.routeVersion,
      operationId: plan.operationId,
    });
  } catch (cause) {
    if (isConflictError(cause)) {
      throw noteNotFound();
    }
    throw cause;
  }
}

/**
 * Steps 3 and 4: re-take the admission decision inside the transaction
 * that destroys the note, then destroy it.
 *
 * The re-check is not a repetition of the entry gate. Nothing the gate
 * looked at moves the note's own version — a membership removal, a
 * restore, a competing purge all commit elsewhere — so the transaction
 * has to ask again, and this is the only ask that decides anything. The
 * entry gate exists to refuse a request that may not delete before any
 * work is done; it is not what the write is allowed to rely on.
 *
 * The revisions go explicitly rather than by referential cascade: no
 * schema in this repository declares a foreign key, and the cross-row
 * cleanup the design calls `ON DELETE CASCADE` is carried by the write
 * that causes it or by the event it emits.
 */
async function deleteLocally(
  container: NotePurgeContainer,
  plan: PurgePlan,
): Promise<LocalOutcome> {
  const now = container.clock.now();
  return container.scopeUnitOfWorkProvider.run(plan.scope, async (ctx) => {
    if (plan.deletionOperationId !== null) {
      await ctx.cleanupAdmission.assertOwner(plan.deletionOperationId);
    }

    const target = await reclaim(ctx, plan, now);
    if (target === null) {
      // Bumped even though nothing was written: the counter is the
      // generation a projection consumer compares against, and a resume
      // that carried a lower one than the lost attempt did would let a
      // snapshot in flight look newer than the removal.
      return {
        kind: "alreadyPurged",
        projectionRevision: await ctx.noteProjectionRevisionStore.bump(
          plan.noteId,
        ),
      };
    }

    const projectionRevision = await ctx.noteProjectionRevisionStore.bump(
      plan.noteId,
    );
    await ctx.noteRevisionRepository.deleteByNote(plan.noteId);
    await ctx.noteRepository.delete(plan.noteId, target.expectedVersion);
    ctx.collectEvents([
      NoteEvents.purged(
        {
          noteId: plan.noteId,
          owner: target.owner,
          sourceFileId: target.sourceFileId,
          operationId: plan.operationId,
          deletionOperationId: plan.deletionOperationId,
          routeVersion: plan.routeVersion,
          projectionRevision,
        },
        now,
      ),
    ]);
    return { kind: "purged", projectionRevision };
  });
}

type PurgeTarget = Readonly<{
  owner: NoteOwner;
  sourceFileId: StoredFileId | null;
  expectedVersion: ExpectedVersion<Note>;
}>;

/**
 * The commit-time gate, or `null` when the note is already gone and the
 * saga is only being carried forward.
 *
 * The two paths diverge on everything but the version. `userRequest`
 * re-takes the whole permission decision from the scope's own
 * membership rows and re-applies the trash barrier, in the fixed
 * refusal order permission → trash → version. `scopeCleanup` asks
 * neither: the actor is a deletion, not a person, and the note may well
 * be active. What it asks instead is that the note the route pointed at
 * really is owned by the scope being cleaned — the one claim a cleanup
 * command makes that the route alone does not prove.
 */
async function reclaim(
  ctx: ScopeUnitOfWorkContext,
  plan: PurgePlan,
  now: Date,
): Promise<PurgeTarget | null> {
  if (plan.actorUserId === null) {
    const stored = await ctx.noteRepository.findById(plan.noteId);
    if (stored === null) {
      return null;
    }
    if (!ScopeKey.equals(scopeOfOwner(stored.entity.owner), plan.scope)) {
      throw foreignScope();
    }
    ensureExpectedVersion(stored.expectedVersion, plan.expectedVersion);
    return {
      owner: stored.entity.owner,
      sourceFileId: stored.entity.sourceFileId,
      expectedVersion: stored.expectedVersion,
    };
  }

  const claimed = await claimNoteForDelete(ctx, {
    noteId: plan.noteId,
    actorUserId: plan.actorUserId,
    now,
  });
  if (!Note.isTrashed(claimed.note)) {
    throw noteNotTrashed();
  }
  ensureExpectedVersion(claimed.expectedVersion, plan.expectedVersion);
  return {
    owner: claimed.note.owner,
    sourceFileId: claimed.note.sourceFileId,
    expectedVersion: claimed.expectedVersion,
  };
}

/**
 * Hands the route back after a refusal, so a note that survived the
 * transaction is reachable again the moment the refusal is reported.
 *
 * The abort's own failure never replaces the refusal that caused it: a
 * route left `purging` is recoverable — the same command re-issued
 * resumes it — while a replaced diagnosis is not.
 */
async function abortQuietly(
  container: NotePurgeContainer,
  plan: PurgePlan,
  cause: unknown,
): Promise<void> {
  try {
    await container.noteRouteStore.abortPurge({
      noteId: plan.noteId,
      operationId: plan.operationId,
      expectedRouteVersion: plan.routeVersion,
    });
  } catch (abortError) {
    container.logger.error("[purgeNote] the claimed route was left purging", {
      cause,
      abortError,
      operationId: plan.operationId,
      noteId: plan.noteId,
      scope: ScopeKey.serialize(plan.scope),
    });
  }
}
