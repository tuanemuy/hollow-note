import { NoteId, type NoteOwner } from "@repo/core/domain/note/valueObject";
import { SystemError, SystemErrorCode } from "../errors";
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
