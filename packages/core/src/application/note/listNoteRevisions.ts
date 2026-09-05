import type { UserId } from "@repo/core/domain/identity/valueObject";
import { NoteRevision } from "@repo/core/domain/note/noteRevision";
import type { ServiceArgs } from "../types";
import { resolveEditableNote } from "./editing";
import type { NoteRevisionListView } from "./view";

export type ListNoteRevisionsInput = Readonly<{
  noteId: string;
  userId: string;
}>;

/**
 * Lists the revisions a note can be restored from (ED-08).
 *
 * Reading them takes `canEdit`, not merely read access: the list exists
 * to drive a restore, and its entries expose earlier bodies of a note a
 * viewer may only be allowed to see the current state of.
 *
 * The excerpt is derived here rather than stored: `NoteRevision` holds
 * only the HTML, and re-deriving keeps the picker from having to carry
 * twenty full bodies to the browser.
 *
 * **The cost is the whole of `process`, once per revision.** `process`
 * parses, applies the allow list, re-serializes, extracts the text and
 * collects the headings whatever it is handed — being already sanitized
 * saves it nothing — and the excerpt is a by-product of that. Bounded by
 * the retention the writers enforce and by `NoteHtml`'s 800 KB ceiling,
 * one listing is therefore worst-case 20 × 800 KB of full sanitization,
 * run synchronously every time the editor opens its revision picker.
 *
 * That is knowingly left standing in this slice. Making it cheap means
 * either a text-extraction-only entry on `HtmlProcessor` — a port
 * change, held by the conformance suites — or an excerpt stored on
 * `NoteRevision`, which `spec/domains/note.md` has to declare first.
 * Neither belongs to the editing slice this usecase ships with.
 *
 * The listing opens a scope unit of work even though it writes nothing:
 * `NoteRevisionRepository` is reachable only from that context, and
 * `NoteReader` — the scope-bound read view — deliberately exposes the
 * `Note` aggregate alone. Author resolution stays outside it, since
 * `UserBatchReader` spans shards the scope does not contain.
 */
export async function listNoteRevisions({
  container,
  input,
}: ServiceArgs<ListNoteRevisionsInput>): Promise<NoteRevisionListView> {
  const { htmlProcessor, scopeUnitOfWorkProvider, userBatchReader } = container;

  const { noteId, scope } = await resolveEditableNote(container, input);

  const revisions = await scopeUnitOfWorkProvider.run(
    scope,
    (ctx): Promise<readonly NoteRevision[]> =>
      ctx.noteRevisionRepository.listByNote(noteId, NoteRevision.RETENTION),
  );

  const authorIds: UserId[] = [
    ...new Set(revisions.map((revision) => revision.createdBy)),
  ];
  const authors = await userBatchReader.resolveMany(authorIds);

  return {
    revisions: revisions.map((revision) => {
      const author = authors.get(revision.createdBy)?.entity;
      return {
        revisionId: revision.id,
        createdAt: revision.createdAt,
        createdBy: revision.createdBy,
        createdByName:
          author === undefined || author.status === "deleted"
            ? null
            : author.displayName,
        reason: revision.reason,
        excerpt: htmlProcessor.process(revision.html).excerpt,
      };
    }),
  };
}
