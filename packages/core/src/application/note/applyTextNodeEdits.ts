import { BusinessRuleError } from "@repo/core/domain/error";
import { NoteErrorCode } from "@repo/core/domain/note/errorCode";
import { Note } from "@repo/core/domain/note/note";
import { NoteRevision } from "@repo/core/domain/note/noteRevision";
import type { TextNodeEdit } from "@repo/core/domain/note/ports/htmlProcessor";
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
} from "./jobs";
import type { AppliedTextNodeEditsView } from "./view";

export type ApplyTextNodeEditsInput = Readonly<{
  noteId: string;
  userId: string;
  edits: readonly TextNodeEdit[];
  expectedVersion: number;
}>;

export type ApplyTextNodeEditsArgs = ServiceArgs<ApplyTextNodeEditsInput> &
  Readonly<{ jobs?: NoteEditingJobs }>;

const cannotCaptureEmptyContent = (): BusinessRuleError<NoteErrorCode> =>
  new BusinessRuleError(
    NoteErrorCode.CannotCaptureEmptyContent,
    "The visual editor needs a ready body to edit",
  );

/**
 * Applies the visual editor's text-node edits, structure intact (ED-02).
 *
 * Every applied result is put back through `HtmlProcessor.process` before
 * it is saved. Two reasons, and the second is the one that must not be
 * dropped: `Note.updateBody` takes a `ProcessedHtml`, so the derived
 * projections (text / excerpt / headings) are rebuilt from the edited
 * body instead of being left describing the previous one — and the body
 * that reaches storage is always a sanitizer output, even if some future
 * `editTextNodes` stops honouring its "no path inside `<style>`" contract.
 *
 * An edit set that lands nowhere is a success, not a refusal: the visual
 * editor sends what the user typed, and a body that moved underneath them
 * yields `skipped` entries the screen can show. Nothing is written in
 * that case, so no revision is spent on a no-op.
 *
 * **Both parses run inside the scope's transaction, unlike
 * `updateNoteBody`**, whose JSDoc states the opposite rule for the
 * opposite reason: there the body arrives with the request and can be
 * sanitized before the transaction opens, because it is a pure
 * computation over a string the request has not yet decided to keep.
 * Here the input of `editTextNodes` is the body the claim just read, so
 * there is no body to work on until the transaction holds one. The cost
 * is charged where the divergence puts it: one autosave keeps the scope's
 * transaction open for a parse → serialize → parse → serialize of a body
 * up to `NoteHtml`'s 800,000 bytes, and on the target platform, where a
 * scope is a single-threaded Durable Object (spec/platform/index.md),
 * that is time no other write to the same scope can use. Reordering to
 * pay it outside would mean sanitizing a body read outside the
 * transaction, which is the read the version check exists to distrust.
 */
export async function applyTextNodeEdits({
  container,
  input,
  jobs = noNoteEditingJobs,
}: ApplyTextNodeEditsArgs): Promise<AppliedTextNodeEditsView> {
  const { clock, htmlProcessor, idGenerator, scopeUnitOfWorkProvider } =
    container;

  const { noteId, actorUserId, scope, note } = await resolveEditableNote(
    container,
    input,
  );
  ensureNotTrashed(note);

  const locking = bodyLockingJob(
    await jobs.listActiveForNote(container, noteId),
  );
  if (locking !== null) {
    throw new BusinessRuleError(
      NoteErrorCode.NoteLockedByJob,
      `A running ${locking.kind} job holds this note`,
    );
  }
  if (note.content.status !== "ready") {
    throw cannotCaptureEmptyContent();
  }

  const now = clock.now();
  const revisionId = idGenerator.next();
  return scopeUnitOfWorkProvider.run(scope, async (ctx) => {
    const claimed = await claimNoteForEdit(ctx, {
      noteId,
      actorUserId,
      expectedVersion: input.expectedVersion,
      now,
    });
    const current = claimed.note.content;
    if (current.status !== "ready") {
      throw cannotCaptureEmptyContent();
    }

    const edited = htmlProcessor.editTextNodes(current.html, input.edits);
    const skipped = edited.skipped.map((entry) => ({
      path: entry.path,
      reason: entry.reason,
    }));
    if (edited.skipped.length === input.edits.length) {
      return { noteId, version: claimed.note.version, skipped };
    }

    await ctx.noteRevisionRepository.insert(
      NoteRevision.capture(
        {
          id: revisionId,
          note: claimed.note,
          createdBy: actorUserId,
          reason: "manualEdit",
        },
        now,
      ),
    );
    await ctx.noteRevisionRepository.deleteOlderThanNewest(
      noteId,
      NoteRevision.RETENTION,
    );
    const updated = Note.updateBody(
      claimed.note,
      htmlProcessor.process(edited.html),
      now,
    );
    await ctx.noteRepository.save(updated.entity, claimed.expectedVersion);
    await ctx.noteProjectionRevisionStore.bump(noteId);
    ctx.collectEvents(updated.eventDrafts);
    return { noteId, version: updated.entity.version, skipped };
  });
}
