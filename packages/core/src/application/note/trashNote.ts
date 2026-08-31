import type { WithEventDrafts } from "@repo/core/domain/common/event";
import type { NoteEvent } from "@repo/core/domain/note/events";
import { type ActiveNote, Note } from "@repo/core/domain/note/note";
import type { ScopeUnitOfWorkContext } from "../execution/unitOfWork";
import { ScopeTaskPriority } from "../ports/scopeTaskScheduler";
import type { ServiceArgs } from "../types";
import {
  claimNoteForDelete,
  ensureExpectedVersion,
  resolveDeletableNote,
} from "./editing";
import {
  ACTIVE_JOB_SWEEP_LIMIT,
  type ActiveNoteJob,
  type NoteTrashJobs,
  noNoteTrashJobs,
} from "./jobs";
import {
  TRASH_EXPIRY_OPERATION_ID,
  TRASH_EXPIRY_TASK_KIND,
} from "./purgeExpiredTrash";
import type { TrashedNoteView } from "./view";

export type TrashNoteInput = Readonly<{
  noteId: string;
  userId: string;
  expectedVersion: number;
  /**
   * The one job to leave running (spec/usecases/note.md「共通: ユース
   * ケースを合成するときの副作用の範囲」). `runBulkNoteOperationItem`
   * passes its own job id so the sweep does not cancel the very job that
   * is calling; a screen passes `null`. **Never reaches the transport
   * boundary** — a caller who could name a job id would be able to
   * exempt someone else's job from the sweep.
   */
  excludingJobId: string | null;
}>;

export type TrashNoteArgs = ServiceArgs<TrashNoteInput> &
  Readonly<{ jobs?: NoteTrashJobs }>;

/**
 * Scope-task kind carrying the rest of a forced-termination sweep that
 * came back full (spec/usecases/job.md「共通: 強制終端の後始末」). The
 * resumption itself (`continueForcedTermination`) belongs to the Job
 * slice; until it lands the row can only be armed by a deployment whose
 * {@link NoteTrashJobs} answers a full page, which
 * {@link noNoteTrashJobs} never does.
 */
export const JOB_TERMINATION_CONTINUATION_KIND = "job.terminationContinued";

/** The one `kind` whose termination leaves a body mid-conversion. */
const CONVERSION_KIND = "conversion";

/**
 * Step 1 of the shared forced-termination cleanup, on the trash path.
 *
 * A conversion stopped from outside never gets to write its own failure,
 * so a body left `processing` would stay that way for good: it refuses a
 * move, survives `restoreNote` unchanged, and no regeneration path can
 * reach it. `regeneration` is excluded because it keeps the body `ready`
 * on failure by design, and every other kind leaves `content.status`
 * alone.
 */
const recoverCanceledConversion = (
  note: ActiveNote,
  terminated: readonly ActiveNoteJob[],
  now: Date,
): WithEventDrafts<ActiveNote, NoteEvent> | null =>
  note.content.status === "processing" &&
  terminated.some((job) => job.kind === CONVERSION_KIND)
    ? Note.markConversionFailed(note, "canceled", now)
    : null;

/**
 * Points the scope's retention alarm at the deadline that comes first.
 *
 * The row is upserted on `(kind, operationId)` and the sweep is one per
 * scope, so the deadline is re-read from the trash rather than taken
 * from the note just trashed: writing this note's own `purgeAfter` would
 * push an older note's deadline out every time something newer was
 * thrown away, and a scope that keeps trashing would never reclaim
 * anything. Reading it inside the same transaction is what makes the
 * note just saved part of the answer.
 */
const armRetentionSweep = async (
  ctx: ScopeUnitOfWorkContext,
): Promise<void> => {
  const deadline = await ctx.noteRepository.findNextPurgeDeadline();
  if (deadline === null) {
    return;
  }
  await ctx.scopeTaskScheduler.schedule({
    kind: TRASH_EXPIRY_TASK_KIND,
    operationId: TRASH_EXPIRY_OPERATION_ID,
    priority: ScopeTaskPriority.expiryCollection,
    dueAt: deadline,
    payload: {},
  });
};

/**
 * Moves a note to the trash (ED-09).
 *
 * One transaction carries all three writes the spec's steps 2–4 name —
 * the forced termination of the note's unfinished jobs, the recovery of
 * a body those jobs left mid-conversion, and `Note.trash` itself. The
 * order of the last two is not a preference: `Note.markConversionFailed`
 * accepts an `ActiveNote` only, so trashing first would leave the body
 * with no way back at all.
 *
 * The scope's retention alarm is armed in that same transaction. It is
 * the only thing that ever reclaims this note, so a response lost
 * between the trashing and the arming must not be able to leave the note
 * with no deadline pointing at it.
 *
 * Step 2 of the shared cleanup — reclaiming the artifacts of an
 * already-succeeded child — has no effect here and is therefore not
 * written: `listActiveByTarget({ type: "note", noteId })` answers with
 * unterminated jobs targeting one note, which is disjoint from the batch
 * parents that alone can hold children. A succeeded export's artifact is
 * left to expire on its own (`collectExpiredArtifacts`).
 *
 * An already-trashed note is answered with its existing timestamps and
 * no write. Idempotence outranks the version check here, which is why
 * the refusal order (permission → trash → version) puts it first: the
 * caller asked for a state the note is already in, and reporting a
 * conflict would make "delete twice" fail for no observable reason.
 */
export async function trashNote({
  container,
  input,
  jobs = noNoteTrashJobs,
}: TrashNoteArgs): Promise<TrashedNoteView> {
  const { clock, scopeUnitOfWorkProvider } = container;

  const { noteId, actorUserId, scope } = await resolveDeletableNote(
    container,
    input,
  );

  const now = clock.now();
  const trashed = await scopeUnitOfWorkProvider.run(scope, async (ctx) => {
    const claimed = await claimNoteForDelete(ctx, {
      noteId,
      actorUserId,
      now,
    });
    if (Note.isTrashed(claimed.note)) {
      return claimed.note;
    }
    ensureExpectedVersion(claimed.expectedVersion, input.expectedVersion);

    const active = await jobs.listActiveForNote(ctx, noteId);
    // The exemption matches one id, never a kind: every other job
    // targeting this note is cancelled whoever is calling, because the
    // reason to cancel — the note is going to the trash — does not
    // depend on the caller.
    const terminated = active.filter(
      (job) => job.jobId !== input.excludingJobId,
    );
    await jobs.cancelAll(ctx, { jobs: terminated, now });
    if (active.length >= ACTIVE_JOB_SWEEP_LIMIT) {
      await ctx.scopeTaskScheduler.schedule({
        kind: JOB_TERMINATION_CONTINUATION_KIND,
        // One sweep per note, so the note id is the whole identity: a
        // turn replayed after a lost response rewrites this row instead
        // of forking a second continuation.
        operationId: noteId,
        priority: ScopeTaskPriority.securityCleanup,
        dueAt: now,
        payload: {
          origin: {
            path: "trashNote",
            noteId,
            excludingJobId: input.excludingJobId,
          },
        },
      });
    }

    const recovered = recoverCanceledConversion(claimed.note, terminated, now);
    const next = Note.trash(recovered?.entity ?? claimed.note, now);
    await ctx.noteRepository.save(next.entity, claimed.expectedVersion);
    await ctx.noteProjectionRevisionStore.bump(noteId);
    await armRetentionSweep(ctx);
    ctx.collectEvents([...(recovered?.eventDrafts ?? []), ...next.eventDrafts]);
    return next.entity;
  });

  return {
    noteId,
    trashedAt: trashed.trashedAt,
    purgeAfter: trashed.purgeAfter,
  };
}
