import type { ExpectedVersion } from "@repo/core/domain/common/transactionalRepository";
import { BusinessRuleError } from "@repo/core/domain/error";
import { UserId } from "@repo/core/domain/identity/valueObject";
import { NoteErrorCode } from "@repo/core/domain/note/errorCode";
import { type ActiveNote, Note } from "@repo/core/domain/note/note";
import type { NoteViewer } from "@repo/core/domain/note/services/noteAccessPolicy";
import { NoteId, type NoteOwner } from "@repo/core/domain/note/valueObject";
import type { RequestContainer } from "../di/types";
import { ConflictError, NotFoundError } from "../errors";
import type { ScopeUnitOfWorkContext } from "../execution/unitOfWork";
import { ScopeKey } from "../scope";
import { noteAccessPolicy, viewerFor } from "./accessControl";

/**
 * Shared entry and commit gates of the note-editing usecases
 * (`updateNoteBody` / `applyTextNodeEdits` / `renameNote` /
 * `changeNoteStyleMode` / `restoreNoteRevision`).
 *
 * They are two halves of one decision, deliberately taken twice. The
 * entry half answers a request that may not edit before any work is
 * done; the commit half re-takes the same decision inside the
 * transaction, because neither a membership change nor a concurrent
 * trash moves the `Note` version this request is holding, so a viewer
 * demoted mid-flight would otherwise land a write with a role they no
 * longer hold (`spec/testcases/note/updateNoteBody.md` — "保存時に除名
 * されている").
 */

export const noteNotFound = (): NotFoundError =>
  new NotFoundError("NOTE_NOT_FOUND", "Note not found");

const noteIsTrashed = (): BusinessRuleError<NoteErrorCode> =>
  new BusinessRuleError(
    NoteErrorCode.NoteIsTrashed,
    "A trashed note cannot be edited",
  );

const versionConflict = (): ConflictError =>
  new ConflictError(
    "OPTIMISTIC_LOCK_FAILURE",
    "The note changed since it was read",
  );

export type EditableNote = Readonly<{
  noteId: NoteId;
  actorUserId: UserId;
  scope: ScopeKey;
  note: Note;
}>;

export const scopeOfOwner = (owner: NoteOwner): ScopeKey =>
  owner.type === "user"
    ? ScopeKey.user(owner.userId)
    : ScopeKey.workspace(owner.workspaceId);

/**
 * Viewer-context resolution (spec/usecases/note.md「共通: 閲覧者コンテキ
 * ストの解決」) narrowed to the editing paths: route → scope-bound read →
 * `NoteAccessPolicy.evaluate`, with everything short of `canEdit`
 * collapsed to `NOTE_NOT_FOUND` so existence is never leaked.
 */
export async function resolveEditableNote(
  container: RequestContainer,
  input: Readonly<{ noteId: string; userId: string }>,
): Promise<EditableNote> {
  const noteId = NoteId.create(input.noteId);
  const actorUserId = UserId.create(input.userId);
  const { scope } = await container.scopeRouter.resolveNote(noteId);

  const versioned = await container.noteReaderFor(scope).findById(noteId);
  if (versioned === null) {
    throw noteNotFound();
  }
  const note = versioned.entity;
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
  return { noteId, actorUserId, scope, note };
}

const viewerInScope = async (
  ctx: ScopeUnitOfWorkContext,
  owner: NoteOwner,
  actorUserId: UserId,
): Promise<NoteViewer> => {
  if (owner.type === "user") {
    return { kind: "user", userId: actorUserId, workspaceRole: null };
  }
  const membership = await ctx.membershipRepository.findByWorkspaceAndUser(
    owner.workspaceId,
    actorUserId,
  );
  return {
    kind: "user",
    userId: actorUserId,
    workspaceRole: membership?.entity.role ?? null,
  };
};

/**
 * Re-reads the note inside the transaction about to write it and returns
 * it with the OCC token that write must consume.
 *
 * The three refusals are ordered as the spec's steps are: permission
 * before the trash barrier before the version check. Ordering only
 * decides which refusal is reported when more than one applies, and this
 * order keeps "you may not edit this note" from being reported as a
 * conflict the caller would retry.
 */
export async function claimNoteForEdit(
  ctx: ScopeUnitOfWorkContext,
  params: Readonly<{
    noteId: NoteId;
    actorUserId: UserId;
    expectedVersion: number;
    now: Date;
  }>,
): Promise<
  Readonly<{ note: ActiveNote; expectedVersion: ExpectedVersion<Note> }>
> {
  await ctx.cleanupAdmission.assertWritable();
  await ctx.cleanupAdmission.assertActorWritable(params.actorUserId);
  await ctx.workspaceOperationLockStore.assertWritable();

  const stored = await ctx.noteRepository.findById(params.noteId);
  if (stored === null) {
    throw noteNotFound();
  }
  const note = stored.entity;
  const access = noteAccessPolicy.evaluate(
    note,
    await viewerInScope(ctx, note.owner, params.actorUserId),
    { tokenHash: null, pass: null },
    params.now,
  );
  if (access.kind !== "granted" || !access.canEdit) {
    throw noteNotFound();
  }
  if (!Note.isActive(note)) {
    throw noteIsTrashed();
  }
  if ((stored.expectedVersion as number) !== params.expectedVersion) {
    throw versionConflict();
  }
  return { note, expectedVersion: stored.expectedVersion };
}

/** The `NoteIsTrashed` refusal taken before any work, on the entry read. */
export function ensureNotTrashed(note: Note): ActiveNote {
  if (!Note.isActive(note)) {
    throw noteIsTrashed();
  }
  return note;
}
