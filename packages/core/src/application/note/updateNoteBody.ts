import { BusinessRuleError } from "@repo/core/domain/error";
import { NoteErrorCode } from "@repo/core/domain/note/errorCode";
import { Note } from "@repo/core/domain/note/note";
import type { RevisionReason } from "@repo/core/domain/note/noteRevision";
import { NoteRevision } from "@repo/core/domain/note/noteRevision";
import type { ServiceArgs } from "../types";
import {
  claimNoteForEdit,
  ensureNotTrashed,
  resolveEditableNote,
} from "./editing";
import {
  bodyLockingJob,
  type NoteEditingJobs,
  noNoteEditingJobs,
  requestReferenceImportIfNeeded,
} from "./jobs";
import type { UpdatedNoteBodyView } from "./view";

export type UpdateNoteBodyInput = Readonly<{
  noteId: string;
  userId: string;
  rawHtml: string;
  expectedVersion: number;
  reason: Extract<RevisionReason, "manualEdit" | "wysiwygConversion">;
  /**
   * Whether newly appearing external references are imported. **Omitted
   * means true**: the conversion paths import without asking, so a false
   * default would make the same HTML keep its decoration when uploaded
   * as a file and lose it when pasted into the editor.
   */
  importReferences?: boolean;
}>;

export type UpdateNoteBodyArgs = ServiceArgs<UpdateNoteBodyInput> &
  Readonly<{ jobs?: NoteEditingJobs }>;

/**
 * Applies a save from the HTML / WYSIWYG editor (ED-03 / ED-04 / ED-08).
 *
 * The body is sanitized *before* the transaction opens — it is a pure
 * computation over a string this request has not yet decided to keep, and
 * the size refusal it can raise (`ContentTooLarge`) should cost no
 * transaction.
 *
 * `NoteRevisionRepository.deleteOlderThanNewest` runs inside the same
 * unit of work as the insert that made the list twenty-one long, rather
 * than after it as the spec's step 7 reads: the repository lives on the
 * scope unit-of-work context and there is no second plane to prune from,
 * so sharing the transaction is both the only option and the stronger
 * one — no window exists in which the note holds more revisions than the
 * invariant allows.
 *
 * The reference-import registration is the one step deliberately left
 * outside: it is a *different* aggregate's write, and losing it costs a
 * decoration that the next save re-registers, while pulling it inside
 * would make a Job failure roll back a body the user already saw saved.
 */
export async function updateNoteBody({
  container,
  input,
  jobs = noNoteEditingJobs,
}: UpdateNoteBodyArgs): Promise<UpdatedNoteBodyView> {
  const { clock, htmlProcessor, idGenerator, scopeUnitOfWorkProvider } =
    container;

  const { noteId, actorUserId, scope, note } = await resolveEditableNote(
    container,
    input,
  );
  ensureNotTrashed(note);

  const activeJobs = await jobs.listActiveForNote(container, noteId);
  const locking = bodyLockingJob(activeJobs);
  if (locking !== null) {
    throw new BusinessRuleError(
      NoteErrorCode.NoteLockedByJob,
      `A running ${locking.kind} job holds this note`,
    );
  }

  const processed = htmlProcessor.process(input.rawHtml);

  const now = clock.now();
  const revisionId = idGenerator.next();
  const saved = await scopeUnitOfWorkProvider.run(scope, async (ctx) => {
    const claimed = await claimNoteForEdit(ctx, {
      noteId,
      actorUserId,
      expectedVersion: input.expectedVersion,
      now,
    });
    // Only a `ready` body has anything to capture; a note still
    // converting is saved over without a revision rather than refused.
    if (claimed.note.content.status === "ready") {
      await ctx.noteRevisionRepository.insert(
        NoteRevision.capture(
          {
            id: revisionId,
            note: claimed.note,
            createdBy: actorUserId,
            reason: input.reason,
          },
          now,
        ),
      );
      await ctx.noteRevisionRepository.deleteOlderThanNewest(
        noteId,
        NoteRevision.RETENTION,
      );
    }
    const updated = Note.updateBody(claimed.note, processed, now);
    await ctx.noteRepository.save(updated.entity, claimed.expectedVersion);
    await ctx.noteProjectionRevisionStore.bump(noteId);
    ctx.collectEvents(updated.eventDrafts);
    return updated.entity;
  });

  const referenceImportJobId =
    (input.importReferences ?? true)
      ? await requestReferenceImportIfNeeded(container, jobs, {
          noteId,
          owner: saved.owner,
          html: processed.html,
          requestedBy: actorUserId,
          activeJobs,
        })
      : null;

  return {
    noteId,
    version: saved.version,
    removed: processed.removed.map((removal) => ({
      kind: removal.kind,
      name: removal.name,
      reason: removal.reason,
    })),
    referenceImportJobId,
  };
}
