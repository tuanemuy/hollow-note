import { BusinessRuleError } from "@repo/core/domain/error";
import { UserId } from "@repo/core/domain/identity/valueObject";
import type { ActiveNote, Note } from "@repo/core/domain/note/note";
import type { HtmlProcessor } from "@repo/core/domain/note/ports/htmlProcessor";
import { NoteId } from "@repo/core/domain/note/valueObject";
import { StorageErrorCode } from "@repo/core/domain/storage/errorCode";
import { UploadValidationPolicy } from "@repo/core/domain/storage/services/uploadValidationPolicy";
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
const TAG_NAME = /[a-zA-Z][^\s/>]*/y;
/**
 * XML's `S` production — space, tab, CR, LF — and nothing else.
 *
 * `String.prototype.trim` is the wrong ruler here: it also drops U+FEFF,
 * U+2000–U+200A, U+2028 / U+2029, U+3000 and the rest of Unicode's
 * whitespace, none of which XML admits after the root element. Judging
 * with it stores a file whose Misc contains character data — a fatal
 * error, so the `image/svg+xml` renders nothing at all. Only U+00A0
 * escapes into `&nbsp;` on the way out of the sanitizer; every other one
 * survives verbatim.
 */
const XML_WHITESPACE_ONLY = /^[\t\n\r ]*$/;

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

type SvgRoot = Readonly<{
  /** Offset just past the root's tag name, where a declaration goes. */
  insertAt: number;
  /** The root's start tag, delimited by the walk rather than by `>`. */
  openTag: string;
}>;

/**
 * Walks to the end of the tag that starts at `from`, treating a quoted
 * attribute value as opaque.
 *
 * A plain `indexOf(">")` is wrong on the sanitizer's own output: the
 * serializer escapes `&` and `"` inside an attribute value but leaves
 * `>` alone, so `data-x="a>b"` would end the tag early.
 */
const readTagEnd = (markup: string, from: number): number => {
  let index = from;
  while (index < markup.length) {
    const character = markup[index];
    if (character === ">") {
      return index + 1;
    }
    if (character === '"' || character === "'") {
      const close = markup.indexOf(character, index + 1);
      if (close === -1) {
        return -1;
      }
      index = close + 1;
      continue;
    }
    index += 1;
  }
  return -1;
};

/**
 * The one `<svg>` root of a sanitized fragment, or `null` when the
 * markup is not a single SVG document.
 *
 * A stored `.svg` is parsed as XML, where content after the root element
 * is a *fatal* error — the file renders nothing at all. The sanitizer
 * answers a body fragment, so `<svg/>…</svg>trailing<p>text</p>` comes
 * back with the trailing markup intact (allow-list-clean, but no longer
 * an SVG document). Deciding on the root element alone would store that
 * as `image/svg+xml`, which is why the whole shape is walked here
 * instead: the root has to open the document, close it, and leave
 * nothing but whitespace outside itself.
 *
 * The walk is a tag scan rather than a parse because its input is
 * already parser output: what it has to be exact about is the tag
 * boundaries the serializer produces, not the grammar of arbitrary HTML.
 */
const findSvgRoot = (markup: string): SvgRoot | null => {
  let index = 0;
  let depth = 0;
  let root: SvgRoot | null = null;
  for (;;) {
    const open = markup.indexOf("<", index);
    const outside = root === null || depth === 0;
    const text = markup.slice(index, open === -1 ? undefined : open);
    if (outside && !XML_WHITESPACE_ONLY.test(text)) {
      return null;
    }
    if (open === -1) {
      break;
    }
    const closing = markup[open + 1] === "/";
    const nameAt = open + (closing ? 2 : 1);
    TAG_NAME.lastIndex = nameAt;
    const name = TAG_NAME.exec(markup);
    const tagEnd =
      name === null ? -1 : readTagEnd(markup, nameAt + name[0].length);
    // A comment, a doctype, a stray `<` or an unterminated tag. The
    // sanitizer emits none of them, and guessing at the shape of one is
    // guessing at whether the document closes.
    if (name === null || tagEnd === -1) {
      return null;
    }
    const isSvg = name[0].toLowerCase() === "svg";
    const selfClosed = markup[tagEnd - 2] === "/";
    if (root === null) {
      if (!isSvg || closing) {
        return null;
      }
      root = {
        insertAt: nameAt + name[0].length,
        openTag: markup.slice(open, tagEnd),
      };
      depth = selfClosed ? 0 : 1;
    } else if (depth === 0) {
      return null;
    } else if (isSvg && !selfClosed) {
      depth += closing ? -1 : 1;
    }
    index = tagEnd;
  }
  return depth === 0 ? root : null;
};

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
 */
const asStandaloneSvg = (markup: string): string | null => {
  const root = findSvgRoot(markup);
  if (root === null) {
    return null;
  }
  const declarations = [
    XMLNS_DECLARATION.test(root.openTag) ? "" : ` xmlns="${SVG_NAMESPACE}"`,
    XLINK_PREFIXED_ATTRIBUTE.test(markup) &&
    !XMLNS_XLINK_DECLARATION.test(root.openTag)
      ? ` xmlns:xlink="${XLINK_NAMESPACE}"`
      : "",
  ].join("");
  return `${markup.slice(0, root.insertAt)}${declarations}${markup.slice(root.insertAt)}`;
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
 * What the acceptance policy answered is that the bytes *open* as SVG —
 * it reads a prologue, not a whole document. Whether they also close as
 * one is decided here, on the markup that will actually be stored, and
 * an input that does not is refused as `UnsupportedMimeType`: the row
 * would otherwise claim `image/svg+xml` for a file no XML parser opens.
 *
 * `process` answers a note-body fragment, so its 800,000-byte cap is the
 * real ceiling of anything that goes through here. That is what
 * `MEDIA_SVG_MAX_BYTES` is chosen against: no input this policy accepts
 * can serialize into a value the body's invariant refuses, so an
 * oversized SVG is refused as `FileTooLarge` in Storage's own vocabulary
 * rather than as a note that is too long.
 */
const sanitizeSvg = (
  htmlProcessor: HtmlProcessor,
  body: Uint8Array,
): Uint8Array => {
  const document = asStandaloneSvg(
    htmlProcessor.process(new TextDecoder().decode(body)).html,
  );
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

  const owner: StorageOwner =
    note.owner.type === "user"
      ? StorageOwner.user(note.owner.userId)
      : StorageOwner.workspace(note.owner.workspaceId);
  await ensureUploadAllowed({
    container,
    input: {
      subjectType: owner.type,
      subjectId: owner.type === "user" ? owner.userId : owner.workspaceId,
      userId: input.userId,
      totalBytes: accepted.size,
      llmCalls: 0,
    },
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
