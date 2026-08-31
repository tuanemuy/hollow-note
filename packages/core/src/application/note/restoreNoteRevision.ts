import { Note } from "@repo/core/domain/note/note";
import { NoteRevision } from "@repo/core/domain/note/noteRevision";
import { NoteTitle, RevisionId } from "@repo/core/domain/note/valueObject";
import { NotFoundError } from "../errors";
import type { ServiceArgs } from "../types";
import {
  claimNoteForEdit,
  ensureNotTrashed,
  resolveEditableNote,
} from "./editing";
import {
  type NoteEditingJobs,
  noNoteEditingJobs,
  requestReferenceImportIfNeeded,
} from "./jobs";
import type { RestoredNoteRevisionView } from "./view";

export type RestoreNoteRevisionInput = Readonly<{
  noteId: string;
  userId: string;
  revisionId: string;
  expectedVersion: number;
}>;

export type RestoreNoteRevisionArgs = ServiceArgs<RestoreNoteRevisionInput> &
  Readonly<{ jobs?: NoteEditingJobs }>;

const revisionNotFound = (): NotFoundError =>
  new NotFoundError("REVISION_NOT_FOUND", "Revision not found");

/**
 * Restores a note's body from one of its revisions (ED-04 / IM-06).
 *
 * The revision's HTML is put back through `HtmlProcessor.process`
 * because a `NoteRevision` stores nothing but the markup: without it the
 * excerpt, headings and plain text would keep describing the body being
 * replaced. Title and style mode travel with it — a revision is a
 * snapshot of all three — and the rename is applied only when the value
 * actually differs, so restoring does not re-stamp a title that is
 * already what the revision held.
 *
 * **Restoring rewinds the reference state.** Importing references does
 * not create a revision, so the newest revision is the body from *before*
 * the import: restoring it turns imported storage URLs back into external
 * ones and `data-imported-stylesheet` back into `data-stylesheet-href`.
 * Re-registering the import is what keeps that body from sitting on
 * references nothing will ever fetch. Storage's own `ReferenceAttempt`
 * rows are deliberately left alone: they record what happened the last
 * time a URL was tried, which rewinding a body does not change.
 */
export async function restoreNoteRevision({
  container,
  input,
  jobs = noNoteEditingJobs,
}: RestoreNoteRevisionArgs): Promise<RestoredNoteRevisionView> {
  const { clock, htmlProcessor, idGenerator, scopeUnitOfWorkProvider } =
    container;

  const { noteId, actorUserId, scope, note } = await resolveEditableNote(
    container,
    input,
  );
  ensureNotTrashed(note);
  const revisionId = RevisionId.create(input.revisionId);

  const now = clock.now();
  const captureId = idGenerator.next();
  const restored = await scopeUnitOfWorkProvider.run(scope, async (ctx) => {
    const claimed = await claimNoteForEdit(ctx, {
      noteId,
      actorUserId,
      expectedVersion: input.expectedVersion,
      now,
    });
    const revision = await ctx.noteRevisionRepository.findById(revisionId);
    // A revision of another note is reported as absent, not as a
    // mismatch: the id alone must not confirm that some other note holds
    // it.
    if (revision === null || revision.noteId !== noteId) {
      throw revisionNotFound();
    }

    await ctx.noteRevisionRepository.insert(
      NoteRevision.capture(
        {
          id: captureId,
          note: claimed.note,
          createdBy: actorUserId,
          reason: "restore",
        },
        now,
      ),
    );
    await ctx.noteRevisionRepository.deleteOlderThanNewest(
      noteId,
      NoteRevision.RETENTION,
    );

    const processed = htmlProcessor.process(revision.html);
    const withBody = Note.updateBody(claimed.note, processed, now);
    const withStyle = Note.changeStyleMode(
      withBody.entity,
      revision.styleMode,
      now,
    );
    const renamed = NoteTitle.equals(withStyle.entity.title, revision.title)
      ? null
      : Note.rename(withStyle.entity, revision.title.value, now);
    const next = renamed?.entity ?? withStyle.entity;

    await ctx.noteRepository.save(next, claimed.expectedVersion);
    await ctx.noteProjectionRevisionStore.bump(noteId);
    ctx.collectEvents([
      ...withBody.eventDrafts,
      ...withStyle.eventDrafts,
      ...(renamed?.eventDrafts ?? []),
    ]);
    return { note: next, html: processed.html };
  });

  await requestReferenceImportIfNeeded(container, jobs, {
    noteId,
    owner: restored.note.owner,
    html: restored.html,
    requestedBy: actorUserId,
    activeJobs: await jobs.listActiveForNote(container, noteId),
  });

  return { noteId, version: restored.note.version };
}
