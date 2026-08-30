import { UserId } from "@repo/core/domain/identity/valueObject";
import type { Note } from "@repo/core/domain/note/note";
import type { HtmlProcessor } from "@repo/core/domain/note/ports/htmlProcessor";
import { NoteId } from "@repo/core/domain/note/valueObject";
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
import type { ScopeKey } from "../scope";
import type { ServiceArgs } from "../types";
import { ensureUploadAllowed } from "../usage/ensureUploadAllowed";
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
const SVG_ROOT_START_TAG = /<svg\b/i;
const XLINK_PREFIXED_ATTRIBUTE = /\sxlink:/i;

const noteNotFound = (): NotFoundError =>
  new NotFoundError("NOTE_NOT_FOUND", "Note not found");

type EditableNote = Readonly<{ scope: ScopeKey; note: Note }>;

/**
 * Resolves the note the media is being inserted into, and refuses anyone
 * who may not edit it.
 *
 * Absence, a `purging` route, a route whose tombstone has not expired,
 * and a viewer without `editNote` all collapse to
 * `NotFoundError("NOTE_NOT_FOUND")`, so an upload never reveals that a
 * note it may not touch exists.
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
  const read = async (): Promise<EditableNote | null> => {
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
  return resolved;
}

/**
 * Puts back the namespace declarations a standalone `.svg` cannot go
 * without.
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
const asStandaloneSvg = (markup: string): string => {
  const root = SVG_ROOT_START_TAG.exec(markup);
  if (root === null) {
    return markup;
  }
  const insertAt = root.index + root[0].length;
  const openTag = markup.slice(root.index, markup.indexOf(">", root.index) + 1);
  const declarations = [
    openTag.includes(" xmlns=") ? "" : ` xmlns="${SVG_NAMESPACE}"`,
    XLINK_PREFIXED_ATTRIBUTE.test(markup) && !openTag.includes(" xmlns:xlink=")
      ? ` xmlns:xlink="${XLINK_NAMESPACE}"`
      : "",
  ].join("");
  return `${markup.slice(0, insertAt)}${declarations}${markup.slice(insertAt)}`;
};

/**
 * Runs an SVG through the sanitizer before it is stored.
 *
 * `HtmlProcessor` is the single application point of the sanitize policy
 * (spec/adr/013), so a stored SVG and an inline `<svg>` in a body are
 * held to the same allow list rather than to two that drift. What comes
 * back is parser output, which is also why the size is measured again
 * afterwards.
 */
const sanitizeSvg = (
  htmlProcessor: HtmlProcessor,
  body: Uint8Array,
): Uint8Array =>
  new TextEncoder().encode(
    asStandaloneSvg(htmlProcessor.process(new TextDecoder().decode(body)).html),
  );

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
    size: ByteSize.create(body.byteLength),
    checksum: null,
  });

  const now = clock.now();
  try {
    await scopeUnitOfWorkProvider.run(scope, async (ctx) => {
      await ctx.cleanupAdmission.assertWritable();
      await ctx.cleanupAdmission.assertActorWritable(userId);
      await ctx.workspaceOperationLockStore.assertWritable();

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
