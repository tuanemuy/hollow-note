import { Note } from "@repo/core/domain/note/note";
import { StyleMode } from "@repo/core/domain/note/valueObject";
import type { ServiceArgs } from "../types";
import {
  claimNoteForEdit,
  ensureNotTrashed,
  resolveEditableNote,
} from "./editing";
import type { NoteStyleModeView } from "./view";

export type ChangeNoteStyleModeInput = Readonly<{
  noteId: string;
  userId: string;
  styleMode: string;
  expectedVersion: number;
}>;

/**
 * Switches whether the default stylesheet is applied to a note (ED-11).
 *
 * Setting the mode it already has still writes and still emits
 * `note.styleModeChanged`. Suppressing the no-op would be a false economy:
 * the read model is rebuilt from a full snapshot on that event, so an
 * event that never fires is the one way `style_mode` can stay
 * permanently stale in the list — while an extra one costs a
 * projection write that lands on the same value.
 */
export async function changeNoteStyleMode({
  container,
  input,
}: ServiceArgs<ChangeNoteStyleModeInput>): Promise<NoteStyleModeView> {
  const { clock, scopeUnitOfWorkProvider } = container;

  const { noteId, actorUserId, scope, note } = await resolveEditableNote(
    container,
    input,
  );
  ensureNotTrashed(note);
  // Validated before the transaction opens: an unknown mode is
  // `InvalidStyleMode` whatever the note's version happens to be.
  const styleMode = StyleMode.create(input.styleMode);

  const now = clock.now();
  const changed = await scopeUnitOfWorkProvider.run(scope, async (ctx) => {
    const claimed = await claimNoteForEdit(ctx, {
      noteId,
      actorUserId,
      expectedVersion: input.expectedVersion,
      now,
    });
    const next = Note.changeStyleMode(claimed.note, styleMode, now);
    await ctx.noteRepository.save(next.entity, claimed.expectedVersion);
    await ctx.noteProjectionRevisionStore.bump(noteId);
    ctx.collectEvents(next.eventDrafts);
    return next.entity;
  });

  return {
    noteId,
    styleMode: changed.styleMode,
    version: changed.version,
  };
}
