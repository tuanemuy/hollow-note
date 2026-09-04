import {
  BusinessRuleError,
  isBusinessRuleError,
} from "@repo/core/domain/error";
import { UserId } from "@repo/core/domain/identity/valueObject";
import type { ActiveNote, Note } from "@repo/core/domain/note/note";
import {
  HTML_PROCESSOR_NOTE_ERROR_CODES,
  type HtmlProcessor,
} from "@repo/core/domain/note/ports/htmlProcessor";
import { NoteId } from "@repo/core/domain/note/valueObject";
import { StorageErrorCode } from "@repo/core/domain/storage/errorCode";
import {
  readSvgDocument,
  UploadValidationPolicy,
} from "@repo/core/domain/storage/services/uploadValidationPolicy";
import { StoredFile } from "@repo/core/domain/storage/storedFile";
import {
  ByteSize,
  type MimeType,
  ObjectKey,
  StorageOwner,
  StoredFileId,
} from "@repo/core/domain/storage/valueObject";
import type { RequestContainer } from "../di/types";
import { NotFoundError } from "../errors";
import { noteAccessPolicy, viewerFor } from "../note/accessControl";
import { ensureNotTrashed } from "../note/editing";
import type { ScopeKey } from "../scope";
import type { ServiceArgs } from "../types";
import { ensureUploadAllowed } from "../usage/ensureUploadAllowed";
import { armOrphanMediaSweepOnFirstMedia } from "./collectOrphanMedia";
import type { StoreMediaView } from "./view";

export type StoreMediaInput = Readonly<{
  userId: string;
  noteId: string;
  fileName: string;
  body: Uint8Array;
}>;

const EXTENSION_BY_MIME_TYPE: Readonly<Record<string, string>> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/svg+xml": "svg",
  "video/mp4": "mp4",
  "video/webm": "webm",
};

const SVG_MIME_TYPE = "image/svg+xml";
const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const XLINK_NAMESPACE = "http://www.w3.org/1999/xlink";
const XLINK_PREFIXED_ATTRIBUTE = /\sxlink:/i;
const XMLNS_DECLARATION = /\sxmlns=/i;
const XMLNS_XLINK_DECLARATION = /\sxmlns:xlink=/i;
const HTML_NBSP_REFERENCE = "&nbsp;";
const XML_NBSP_REFERENCE = "&#160;";

const noteNotFound = (): NotFoundError =>
  new NotFoundError("NOTE_NOT_FOUND", "Note not found");

type EditableNote = Readonly<{ scope: ScopeKey; note: ActiveNote }>;

/**
 * Resolves the note the media is being inserted into, and refuses anyone
 * who may not edit it.
 *
 * Absence, a `purging` route, a route whose tombstone has not expired,
 * and a viewer without `editNote` all collapse to
 * `NotFoundError("NOTE_NOT_FOUND")`, so an upload never reveals that a
 * note it may not touch exists.
 *
 * A trashed note is then refused as `NoteIsTrashed`, through the same
 * gate the body-editing usecases take (`note/editing.ts`). The trash is
 * no barrier to its owner in `NoteAccessPolicy` — `canEdit` stays true —
 * so without this an upload succeeds into a note whose body no longer
 * accepts the reference: the bytes fill the subject's capacity and sit
 * there until the note is purged or the 30-day orphan sweep reaches
 * them.
 *
 * The scope read is retried once against a freshly resolved route. A note
 * that moved between the route read and the scope read leaves the first
 * scope holding nothing, and the second resolution is what sends the
 * bytes to the scope that now owns the note instead of failing a request
 * whose only problem was timing.
 */
async function resolveEditableNote(
  container: RequestContainer,
  noteId: NoteId,
  userId: string,
): Promise<EditableNote> {
  const read = async (): Promise<Readonly<{
    scope: ScopeKey;
    note: Note;
  }> | null> => {
    const { scope } = await container.scopeRouter.resolveNote(noteId);
    const versioned = await container.noteReaderFor(scope).findById(noteId);
    return versioned === null ? null : { scope, note: versioned.entity };
  };

  const resolved = (await read()) ?? (await read());
  if (resolved === null) {
    throw noteNotFound();
  }

  const viewer = await viewerFor(container, resolved.note.owner, userId);
  const access = noteAccessPolicy.evaluate(
    resolved.note,
    viewer,
    { tokenHash: null, pass: null },
    container.clock.now(),
  );
  if (access.kind !== "granted" || !access.canEdit) {
    throw noteNotFound();
  }
  return { scope: resolved.scope, note: ensureNotTrashed(resolved.note) };
}

/**
 * Puts back the namespace declarations a standalone `.svg` cannot go
 * without, or answers `null` when the sanitized markup is not one
 * document to begin with.
 *
 * `HtmlProcessor` drops every `xmlns*` attribute, and rightly so for what
 * it is built for: it sanitizes body fragments, where an inline `<svg>`
 * takes the SVG namespace from the HTML parser and a declaration would be
 * dead weight. A stored file has no host document — served as
 * `image/svg+xml` it is parsed as XML, so a missing `xmlns` renders
 * nothing at all and a surviving `xlink:href` whose prefix was never
 * declared is a fatal parse error.
 *
 * The declarations are the document's *form*, not part of the allow list,
 * which is why they are restored here instead of inside the sanitizer:
 * spec/adr/013 keeps exactly one application point for the rules
 * themselves, and this adds no element and no attribute the sanitizer
 * decided against.
 *
 * `&nbsp;` is rewritten for the same reason. It is the one reference an
 * HTML serializer emits that XML has no name for — U+00A0 comes back as
 * `&nbsp;`, and a `.svg` carries no DTD to define it — so the numeric
 * form says the same thing in a vocabulary the document owns. Nothing
 * else needs the treatment: every other `&` in parser output is already
 * one of the five XML predefines, which is what `readSvgDocument`
 * verifies afterwards rather than assumes.
 */
const asStandaloneSvg = (markup: string): string | null => {
  const document = markup.replaceAll(HTML_NBSP_REFERENCE, XML_NBSP_REFERENCE);
  const root = readSvgDocument(document);
  if (root === null) {
    return null;
  }
  const declarations = [
    XMLNS_DECLARATION.test(root.rootTag) ? "" : ` xmlns="${SVG_NAMESPACE}"`,
    XLINK_PREFIXED_ATTRIBUTE.test(document) &&
    !XMLNS_XLINK_DECLARATION.test(root.rootTag)
      ? ` xmlns:xlink="${XLINK_NAMESPACE}"`
      : "",
  ].join("");
  return `${document.slice(0, root.rootNameEnd)}${declarations}${document.slice(root.rootNameEnd)}`;
};

/**
 * The port's own declaration of what `process` can raise in Note's
 * vocabulary, as a set. Drawing it from there rather than restating the
 * codes is what keeps this boundary from going stale: a third code added
 * to the contract is answered here without an edit.
 */
const NOTE_LIMIT_CODES: ReadonlySet<string> = new Set(
  HTML_PROCESSOR_NOTE_ERROR_CODES,
);

/**
 * Sanitizes the uploaded bytes, restoring Storage's vocabulary on every
 * failure `HtmlProcessor` answers in Note's.
 *
 * The note body's codes are in neither `storeMedia`'s error table nor
 * the vocabulary an uploader can act on, and the display dictionary
 * answers them with advice about a body this person never edited.
 *
 * **The promise is kept by covering the set, not by arguing the set is
 * unreachable.** Every earlier version of this boundary translated one
 * code and rested the rest on a derivation — first about the shape of
 * the accepted markup, then about `maxExpansionFactor` × 131,072 staying
 * under 800,000. Each was refuted by measurement (spec/adr/013 retired
 * the first line of reasoning; the second dies on the meter charging a
 * node's pre-escape length, so a single-quoted attribute value stuffed
 * with raw `"` is six output bytes per byte charged). What is left is
 * structural: every code the port declares means "the sanitized form is
 * too big to keep", and all of them are answered here.
 *
 * The intake's element-name gate is not asked to make any of this
 * unreachable. It reads XML comments and processing instructions to
 * *XML's* terminators, while the HTML tokenizer ends `<?a>` at the first
 * `>` and treats `<!-->` as a complete comment — so eight characters put
 * a `<table>` where only one of the two can see it. The gate stays as
 * the cheap front-line defence it is.
 *
 * `FileTooLarge` is the translation because both codes are ceilings on
 * length, and an input that trips either has a sanitized form far past
 * `MEDIA_SVG_MAX_BYTES` — the same answer step 4 gives once the parse
 * has been paid for (spec/usecases/storage.md#storeMedia).
 * `UnsupportedMimeType` would claim the format is not accepted, which is
 * false and leaves the uploader nothing to change.
 */
const processSvg = (htmlProcessor: HtmlProcessor, body: Uint8Array): string => {
  try {
    return htmlProcessor.process(new TextDecoder().decode(body)).html;
  } catch (error) {
    if (isBusinessRuleError(error) && NOTE_LIMIT_CODES.has(error.code)) {
      throw new BusinessRuleError(
        StorageErrorCode.FileTooLarge,
        "The SVG does not sanitize into anything this store will hold",
      );
    }
    throw error;
  }
};

/**
 * Runs an SVG through the sanitizer before it is stored.
 *
 * `HtmlProcessor` is the single application point of the sanitize policy
 * (spec/adr/013), so a stored SVG and an inline `<svg>` in a body are
 * held to the same allow list rather than to two that drift. What comes
 * back is parser output, which is also why the size is measured again
 * afterwards.
 *
 * What the acceptance policy answered is that the *uploaded bytes* are a
 * well-formed SVG document. That is not the same question as the one
 * here: `process` answers a body **fragment**, serialized as HTML, and
 * the two grammars part company in ways that only matter once the result
 * is served as `image/svg+xml` — content left after the root, `&nbsp;`
 * for a U+00A0, a void element the HTML parser resumed inside `<desc>`.
 * So the same predicate is asked again of the markup that will actually
 * be stored, and an input that fails it is refused as
 * `UnsupportedMimeType`: the row would otherwise claim `image/svg+xml`
 * for a file no XML parser opens.
 *
 * `process` answers a note-body fragment, so a sanitized SVG is held to
 * the note body's own caps on the way through — caps whose codes belong
 * to Note. Nothing about the accepted bytes puts those caps out of
 * reach, and no derivation is asked to: `processSvg` translates the
 * whole set of them, which is what guarantees the answer stays in
 * Storage's vocabulary.
 */
const sanitizeSvg = (
  htmlProcessor: HtmlProcessor,
  body: Uint8Array,
): Uint8Array => {
  const document = asStandaloneSvg(processSvg(htmlProcessor, body));
  if (document === null) {
    throw new BusinessRuleError(
      StorageErrorCode.UnsupportedMimeType,
      "The SVG does not sanitize into a single standalone document",
    );
  }
  return new TextEncoder().encode(document);
};

/**
 * Stores an image or a video the editor inserts into a note body.
 *
 * Type and size are read from the bytes rather than declared by the
 * caller, as everywhere else uploads are accepted: a declaration only
 * says what the sender wanted the object taken for.
 *
 * The quota is checked here, unlike `storeAvatar`: media accumulates one
 * file per insertion with nothing deleting the previous one, so it is
 * exactly the growth the capacity limit exists to bound.
 *
 * `noteId` is persisted on the row, and it is the only handle the two
 * reclaim paths have — `collectOrphanMedia` decides on it whether a file
 * is still referenced, and `deleteFilesForNote` sweeps by it after a
 * purge.
 *
 * The first media a scope ever stores also arms that sweep's daily
 * alarm, in the same transaction as the row it registers: nothing else
 * in the scope has a reason to start it.
 */
export async function storeMedia({
  container,
  input,
}: ServiceArgs<StoreMediaInput>): Promise<StoreMediaView> {
  const {
    clock,
    htmlProcessor,
    idGenerator,
    logger,
    objectStorage,
    scopeUnitOfWorkProvider,
  } = container;

  const userId = UserId.create(input.userId);
  const noteId = NoteId.create(input.noteId);
  const { scope, note } = await resolveEditableNote(
    container,
    noteId,
    input.userId,
  );

  const accepted = UploadValidationPolicy.ensureAcceptable({
    purpose: "media",
    body: input.body,
  });

  const mimeType: MimeType = accepted.mimeType;
  const body =
    mimeType === SVG_MIME_TYPE
      ? sanitizeSvg(htmlProcessor, input.body)
      : input.body;
  // Sanitizing rewrites the bytes, so the size the policy accepted is no
  // longer the size being stored. The stored bytes are what fills the
  // subject's capacity and what the row records, so they are the ones
  // the ceiling has to hold.
  const storedSize = ByteSize.create(body.byteLength);
  if (
    ByteSize.exceeds(
      storedSize,
      UploadValidationPolicy.limitFor("media", mimeType),
    )
  ) {
    throw new BusinessRuleError(
      StorageErrorCode.FileTooLarge,
      "File exceeds the media size limit once sanitized",
    );
  }

  const owner: StorageOwner =
    note.owner.type === "user"
      ? StorageOwner.user(note.owner.userId)
      : StorageOwner.workspace(note.owner.workspaceId);
  // The capacity is weighed after the rewrite, on the same value: what
  // fills a subject's quota is what the row records, and asking the gate
  // about the bytes as they arrived would let an SVG that grows overrun
  // the remaining capacity and one that shrinks be refused for room it
  // does not need. Sanitizing an over-quota upload first is bounded work
  // — the intake caps an SVG at `MEDIA_SVG_MAX_BYTES` and the processor
  // holds itself to `HtmlProcessorLimit` whatever shape those bytes have
  // — and no byte reaches the object store before this gate.
  await ensureUploadAllowed({
    container,
    input: {
      subjectType: owner.type,
      subjectId: owner.type === "user" ? owner.userId : owner.workspaceId,
      userId: input.userId,
      totalBytes: storedSize,
      llmCalls: 0,
    },
  });

  const fileId = StoredFileId.create(idGenerator.next());
  const objectKey = ObjectKey.build(
    owner,
    "media",
    fileId,
    EXTENSION_BY_MIME_TYPE[mimeType] ?? null,
  );
  const stored = await objectStorage.put(objectKey, body, {
    mimeType,
    // The declared size, which `put` re-measures from what it stored:
    // declare the sanitized bytes' length rather than the accepted body's
    // so the two can never disagree.
    size: storedSize,
    checksum: null,
  });

  const now = clock.now();
  try {
    await scopeUnitOfWorkProvider.run(scope, async (ctx) => {
      await ctx.cleanupAdmission.assertWritable();
      await ctx.cleanupAdmission.assertActorWritable(userId);
      await ctx.workspaceOperationLockStore.assertWritable();
      await armOrphanMediaSweepOnFirstMedia(ctx, now);

      const registered = StoredFile.register(
        {
          id: fileId,
          owner,
          objectKey,
          fileName: input.fileName,
          mimeType,
          size: stored.size,
          checksum: stored.checksum,
          purpose: "media",
          noteId,
          uploadedBy: userId,
        },
        now,
      );
      await ctx.storedFileRepository.insert(registered.entity);
      ctx.collectEvents(registered.eventDrafts);
    });
  } catch (error) {
    // The object store cannot join the transaction, so bytes written
    // without their row would be unreachable: no owner scan and no
    // `storage.fileDeleted` would ever name them. Removing a key is
    // idempotent, and only this call knows it exists.
    try {
      await objectStorage.deleteMany([objectKey]);
    } catch (cause) {
      logger.error("[storeMedia] rollback of the stored object failed", {
        cause,
        objectKey,
      });
    }
    throw error;
  }

  return {
    fileId,
    url: objectStorage.publicUrl(objectKey),
    mimeType,
    size: stored.size,
  };
}
