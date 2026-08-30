import { Note } from "@repo/core/domain/note/note";
import { ValidationError } from "../errors";
import type { ServiceArgs } from "../types";
import {
  claimNoteForDelete,
  ensureExpectedVersion,
  resolveDeletableNote,
} from "./editing";
import type { RestoredNoteView } from "./view";

export type RestoreNoteInput = Readonly<{
  noteId: string;
  userId: string;
  expectedVersion: number;
}>;

const noteNotTrashed = (): ValidationError =>
  new ValidationError("NOTE_NOT_TRASHED", "The note is not in the trash");

/**
 * Takes a note back out of the trash (ED-10).
 *
 * `Note.restore` drops the two trash timestamps and nothing else, so
 * everything the note carried while it was hidden comes back with it —
 * the publication status, the share link and its password, the tag
 * assignments held on the other side of the aggregate boundary. That is
 * what makes restoring the inverse of trashing rather than a second
 * creation, and it is why nothing here has to be re-derived.
 *
 * A note that is not in the trash is `NOTE_NOT_TRASHED` rather than a
 * silent success: unlike trashing, restoring is not idempotent from the
 * caller's point of view — a live note reached this call because the
 * screen was looking at a stale trash listing, and saying so is what
 * lets it re-read.
 */
export async function restoreNote({
  container,
  input,
}: ServiceArgs<RestoreNoteInput>): Promise<RestoredNoteView> {
  const { clock, scopeUnitOfWorkProvider } = container;

  const { noteId, actorUserId, scope } = await resolveDeletableNote(
    container,
    input,
  );

  const now = clock.now();
  const restored = await scopeUnitOfWorkProvider.run(scope, async (ctx) => {
    const claimed = await claimNoteForDelete(ctx, {
      noteId,
      actorUserId,
      now,
    });
    if (!Note.isTrashed(claimed.note)) {
      throw noteNotTrashed();
    }
    ensureExpectedVersion(claimed.expectedVersion, input.expectedVersion);

    const next = Note.restore(claimed.note, now);
    await ctx.noteRepository.save(next.entity, claimed.expectedVersion);
    await ctx.noteProjectionRevisionStore.bump(noteId);
    ctx.collectEvents(next.eventDrafts);
    return next.entity;
  });

  return { noteId, visibility: restored.visibility.status };
}
