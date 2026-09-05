import { Note } from "@repo/core/domain/note/note";
import { NoteTitle } from "@repo/core/domain/note/valueObject";
import type { ServiceArgs } from "../types";
import {
  claimNoteForEdit,
  ensureNotTrashed,
  resolveEditableNote,
} from "./editing";
import type { RenamedNoteView } from "./view";

export type RenameNoteInput = Readonly<{
  noteId: string;
  userId: string;
  title: string;
  expectedVersion: number;
}>;

/**
 * Renames a note (ED-07).
 *
 * The title is constructed once *before* the transaction so an over-long
 * one is refused with `InvalidTitle` without opening it — the same
 * ordering `createBlankNote` uses. `NoteTitle` folds blank input to
 * 「無題」 rather than refusing it, which is why an empty title is a
 * success here.
 *
 * The origin always becomes `manual`: a rename is a user decision, and
 * that is exactly what stops a later conversion result from overwriting
 * it (`Note.applyConversionResult` only renames an `auto` title).
 */
export async function renameNote({
  container,
  input,
}: ServiceArgs<RenameNoteInput>): Promise<RenamedNoteView> {
  const { clock, scopeUnitOfWorkProvider } = container;

  const { noteId, actorUserId, scope, note } = await resolveEditableNote(
    container,
    input,
  );
  ensureNotTrashed(note);
  const title = NoteTitle.manual(input.title);

  const now = clock.now();
  const renamed = await scopeUnitOfWorkProvider.run(scope, async (ctx) => {
    const claimed = await claimNoteForEdit(ctx, {
      noteId,
      actorUserId,
      expectedVersion: input.expectedVersion,
      now,
    });
    const next = Note.rename(claimed.note, title.value, now);
    await ctx.noteRepository.save(next.entity, claimed.expectedVersion);
    await ctx.noteProjectionRevisionStore.bump(noteId);
    ctx.collectEvents(next.eventDrafts);
    return next.entity;
  });

  return {
    noteId,
    title: renamed.title.value,
    version: renamed.version,
  };
}
