import { NoteId, type NoteOwner } from "@repo/core/domain/note/valueObject";
import { ConflictError, SystemError, SystemErrorCode } from "../errors";
import type { ScopeUnitOfWorkContext } from "../execution/unitOfWork";
import type { ScopeTaskPayload } from "../ports/scopeTaskScheduler";
import { ScopeTaskPriority } from "../ports/scopeTaskScheduler";
import { ScopeKey } from "../scope";

/**
 * The shape every `note.purged` follower shares.
 *
 * Each of them — stored files, tag assignments, backup records — reclaims
 * one bounded page of its own rows per turn and re-arms itself while a
 * page comes back full. The turn is fully described by the note and the
 * cleanup token it inherited, so a re-claimed row repeats exactly the
 * turn it named, and because a turn deletes the rows it just read,
 * reading from the start always moves forward — no cursor is carried.
 *
 * The continuation row is keyed by `(kind, operationId)` where
 * `operationId` is the purge's own operation id, so a redelivered
 * `note.purged` re-writes the one row instead of multiplying
 * continuations.
 */
export type NotePurgeFanOutTurn = Readonly<{
  noteId: NoteId;
  /**
   * Cleanup admission token when the purge came from an account or
   * workspace deletion; `null` for an ordinary purge, which has no
   * barrier to prove ownership of.
   */
  deletionOperationId: string | null;
}>;

export const scopeOfNoteOwner = (owner: NoteOwner): ScopeKey =>
  owner.type === "user"
    ? ScopeKey.user(owner.userId)
    : ScopeKey.workspace(owner.workspaceId);

const corrupt = (detail: string): SystemError =>
  new SystemError(
    SystemErrorCode.DataIntegrityError,
    `Note purge continuation: ${detail}`,
  );

export const readNotePurgeTurn = (
  payload: ScopeTaskPayload,
): NotePurgeFanOutTurn => {
  const noteId = payload.noteId;
  if (typeof noteId !== "string" || noteId.length === 0) {
    throw corrupt("payload carries no noteId");
  }
  const token = payload.deletionOperationId;
  if (token !== null && token !== undefined && typeof token !== "string") {
    throw corrupt("payload carries an invalid deletionOperationId");
  }
  return {
    noteId: NoteId.create(noteId),
    deletionOperationId:
      typeof token === "string" && token.length > 0 ? token : null,
  };
};

/**
 * Re-checks, on every turn, that the cleanup token the turn inherited
 * still names **this scope's** barrier — and admits the turn when it
 * does, whether that barrier is still running or already completed.
 *
 * `assertOwner` cannot be used here. It asks "may cleaning still
 * proceed?", so it turns false the moment the receipt completes; but the
 * component that completes the barrier is `note` itself, and the purges
 * it acknowledges emit `note.purged` from their own transactions for the
 * relay to deliver **afterwards**. Asking `assertOwner` would therefore
 * reject the fan-out of every purge the barrier waited for, first
 * delivery and continuation alike, until the outbox row quarantined and
 * the scope task failed — and nothing else reclaims tag assignments or
 * backup records (`./participants.ts`).
 *
 * Admitting a completed barrier is safe because a follower acknowledges
 * nothing: it deletes rows of a note whose purge already committed, so
 * it cannot walk a completed receipt back to `running`. What stays
 * refused is a token that does not describe this scope at all — a
 * foreign operation's barrier, or one that was withdrawn — which is the
 * per-turn ownership re-check the usecases specify.
 */
export const assertNotePurgeAdmission = async (
  ctx: ScopeUnitOfWorkContext,
  deletionOperationId: string | null,
): Promise<void> => {
  if (deletionOperationId === null) {
    return;
  }
  const progress =
    await ctx.cleanupAdmission.describePersonalCleanup(deletionOperationId);
  if (progress === null) {
    throw new ConflictError(
      "CLEANUP_OPERATION_MISMATCH",
      `Operation ${deletionOperationId} does not own this scope's cleanup`,
    );
  }
};

/**
 * Re-arms this follower's own continuation inside the transaction that
 * deleted the page, so a lost response cannot drop the rest of the work.
 *
 * Priority is the security-cleanup class for every purge, deletion-driven
 * or not: what these turns reclaim is data a user asked to be gone, and
 * the same rows back an account deletion's barrier when one is running.
 */
export const armNotePurgeContinuation = async (
  ctx: ScopeUnitOfWorkContext,
  params: Readonly<{
    kind: string;
    operationId: string;
    turn: NotePurgeFanOutTurn;
    now: Date;
  }>,
): Promise<void> => {
  await ctx.scopeTaskScheduler.schedule({
    kind: params.kind,
    operationId: params.operationId,
    priority: ScopeTaskPriority.securityCleanup,
    dueAt: params.now,
    payload: {
      noteId: params.turn.noteId,
      deletionOperationId: params.turn.deletionOperationId,
    },
  });
};
