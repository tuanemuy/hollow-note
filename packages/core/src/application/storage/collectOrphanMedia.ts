import type { HtmlProcessor } from "@repo/core/domain/note/ports/htmlProcessor";
import type { NoteId } from "@repo/core/domain/note/valueObject";
import type {
  ObjectKey,
  StoredFileId,
} from "@repo/core/domain/storage/valueObject";
import type { SharedDeps } from "../di/types";
import type {
  ScopeUnitOfWorkContext,
  ScopeUnitOfWorkProvider,
} from "../execution/unitOfWork";
import type { ObjectStorage } from "../ports/objectStorage";
import { ScopeTaskPriority } from "../ports/scopeTaskScheduler";
import type { ScopeKey } from "../scope";
import { deleteStoredFiles } from "./deleteFiles";

/**
 * Scope-task kind carrying the orphan-media sweep of one scope.
 *
 * The row is armed by the first media that appears in the scope
 * ({@link armOrphanMediaSweepOnFirstMedia}) and moved by every turn —
 * to immediately after while a full page is still yielding progress,
 * and to the next day otherwise. It is never completed: the sweep is
 * periodic, and a scope that once held media can grow an orphan again
 * at any time.
 */
export const ORPHAN_MEDIA_TASK_KIND = "storage.orphanMediaContinued";

/**
 * The sweep is one per scope, not one per file or per run, so the row's
 * identity is a constant: a turn replayed after a lost response rewrites
 * the same row instead of leaving a second sweep behind.
 */
export const ORPHAN_MEDIA_OPERATION_ID = "storage.orphanMediaSweep";

/**
 * Files one turn inspects. The cap bounds the CPU of a single alarm
 * turn — one body parse per candidate — and the `storage.fileDeleted`
 * fan-out it emits (spec/platform/index.md「実行予算と分割単位」).
 */
export const ORPHAN_MEDIA_BATCH_SIZE = 100;

/**
 * How long a media file is spared regardless of the body.
 *
 * Measured from creation rather than from the moment the reference was
 * dropped, because nothing records that moment
 * (spec/domains/storage.md). The window is what makes the sweep safe for
 * a file uploaded into a body that has not been saved yet.
 */
export const ORPHAN_MEDIA_MIN_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/** Distance to the next sweep once the current one has nothing left. */
export const ORPHAN_MEDIA_SWEEP_INTERVAL_MS = 24 * 60 * 60 * 1000;

export type CollectOrphanMediaInput = Readonly<{
  /** Scope whose alarm fired. The sweep is scope-local. */
  scope: ScopeKey;
  limit?: number;
}>;

export type CollectOrphanMediaView = Readonly<{ collectedCount: number }>;

/**
 * The ports the sweep is written against, and nothing else.
 *
 * `htmlProcessor` is a pure computation over a body and `publicUrl` a
 * pure computation over an object key, so both are read outside the
 * transaction; the scope's unit of work is where the listing, the note
 * reads and the deletions happen. Naming the four as their own type is
 * what lets the alarm reach the sweep from the worker plane without that
 * plane taking on the request path's viewer resolution — `RequestContainer`
 * and `WorkerContainer` both satisfy it structurally.
 */
export type OrphanMediaContainer = SharedDeps &
  Readonly<{
    scopeUnitOfWorkProvider: ScopeUnitOfWorkProvider;
    objectStorage: Pick<ObjectStorage, "publicUrl">;
    htmlProcessor: Pick<HtmlProcessor, "extractExternalReferences">;
  }>;

export type CollectOrphanMediaArgs = Readonly<{
  container: OrphanMediaContainer;
  input: CollectOrphanMediaInput;
}>;

/**
 * Arms the daily sweep the first time media appears in a scope.
 *
 * Runs in the caller's transaction, before the row it is about to insert,
 * so "no media yet" and "this is the first one" are the same read. Arming
 * on *every* insertion would be worse than useless: `schedule` upserts on
 * `(kind, operationId)` and overwrites `dueAt`, so a scope whose editor
 * inserts an image a day would push its own sweep out of reach forever.
 *
 * Every path that puts a `media` row into a scope owes this call, since
 * "the scope holds media" is what the presence of the sweep row stands
 * for. There are two: `storeMedia`, and the `stageTarget` phase of
 * `relocateFilesForNote`, which is how a moved note's media arrives in a
 * scope that may never have held any.
 */
export async function armOrphanMediaSweepOnFirstMedia(
  ctx: ScopeUnitOfWorkContext,
  now: Date,
): Promise<void> {
  const existing = await ctx.storedFileRepository.listByPurposeOlderThan(
    "media",
    now,
    1,
  );
  if (existing.length > 0) {
    return;
  }
  await ctx.scopeTaskScheduler.schedule({
    kind: ORPHAN_MEDIA_TASK_KIND,
    operationId: ORPHAN_MEDIA_OPERATION_ID,
    priority: ScopeTaskPriority.expiryCollection,
    dueAt: new Date(now.getTime() + ORPHAN_MEDIA_SWEEP_INTERVAL_MS),
    payload: {},
  });
}

/**
 * Whether a reference found in a body addresses this stored object.
 *
 * A body holds what `storeMedia` handed the editor, which is `publicUrl`
 * verbatim, so equality settles the ordinary case. The path comparison
 * covers the same address written in its other form — a deployment whose
 * `publicUrl` is app-relative still sees absolute URLs in a body that was
 * pasted or imported — without the sweep needing to know the deployment's
 * own origin, which the worker plane has no `appUrl` to tell it. It errs
 * towards *keeping* a file, since a wrong answer there costs storage and
 * the opposite one costs a picture in someone's note.
 */
const addressesSameObject = (reference: string, fileUrl: string): boolean => {
  if (reference === fileUrl) {
    return true;
  }
  const base = "https://orphan-media.invalid";
  return (
    URL.canParse(reference, base) &&
    URL.canParse(fileUrl, base) &&
    new URL(reference, base).pathname === new URL(fileUrl, base).pathname
  );
};

/**
 * Decides one candidate on its own note's body.
 *
 * The owning note comes from `FileProvenance.noteId`, which `media`
 * carries by construction, so nothing has to search bodies for the file.
 * That is also why another note referencing the same URL does not save
 * it: the sweep asks whether *this* note still uses it.
 *
 * `extractExternalReferences` is deliberately not filtered through
 * `StorageUrlPolicy.isInternal` — an internal storage URL is exactly what
 * is being looked for (spec/usecases/storage.md#collectorphanmedia).
 *
 * A note that is gone is terminal, so its media is collectable. A note
 * whose content is not `ready` is the opposite: it has no body to read,
 * and "no body" is not evidence the reference was dropped, so the file is
 * spared until the body comes back.
 */
async function isOrphan(
  container: OrphanMediaContainer,
  ctx: ScopeUnitOfWorkContext,
  noteId: NoteId,
  objectKey: ObjectKey,
): Promise<boolean> {
  const versioned = await ctx.noteRepository.findById(noteId);
  if (versioned === null) {
    return true;
  }
  const content = versioned.entity.content;
  if (content.status !== "ready") {
    return false;
  }
  const fileUrl = container.objectStorage.publicUrl(objectKey);
  return !container.htmlProcessor
    .extractExternalReferences(content.html)
    .some((reference) => addressesSameObject(reference.url, fileUrl));
}

/**
 * Reclaims media that no body references any more (UC-storage-010,
 * spec/usecases/storage.md#collectorphanmedia).
 *
 * Collection needs both conditions: old enough *and* unreferenced. The
 * age is the listing's own predicate, so a young file is never even
 * inspected, and the boundary is inclusive — a file created exactly
 * `now - 30 days` is in the page.
 *
 * The listing walks the whole scope rather than one owner's files, which
 * is why it is `listByPurposeOlderThan` and not `listByOwner`: a scope's
 * media belongs to whoever uploaded it and the sweep has no owner to
 * filter by.
 *
 * Deciding and deleting are separate transactions, and each deletion is a
 * transaction of its own, because one file that cannot be removed must
 * not take the rest of the page down with it (spec's「個々の失敗は記録
 * して継続」).
 *
 * The row is then moved rather than completed. Immediately after only
 * when a full page *also* made progress: the listing has no cursor and
 * the sweep keeps what it spares, so re-arming a full page that collected
 * nothing would re-read the same page forever.
 */
export async function collectOrphanMedia({
  container,
  input,
}: CollectOrphanMediaArgs): Promise<CollectOrphanMediaView> {
  const limit = Math.min(
    Math.max(1, input.limit ?? ORPHAN_MEDIA_BATCH_SIZE),
    ORPHAN_MEDIA_BATCH_SIZE,
  );
  const now = container.clock.now();
  const createdBefore = new Date(now.getTime() - ORPHAN_MEDIA_MIN_AGE_MS);

  const scan = await container.scopeUnitOfWorkProvider.run(
    input.scope,
    async (ctx) => {
      const candidates = await ctx.storedFileRepository.listByPurposeOlderThan(
        "media",
        createdBefore,
        limit,
      );
      const orphans: StoredFileId[] = [];
      for (const file of candidates) {
        const noteId = file.noteId;
        // `media` provenance carries its note by construction; the guard
        // is the listing contract restated where it is relied on.
        if (file.purpose !== "media" || noteId === null) {
          continue;
        }
        if (await isOrphan(container, ctx, noteId, file.objectKey)) {
          orphans.push(file.id);
        }
      }
      return { scanned: candidates.length, orphans };
    },
  );

  let collectedCount = 0;
  for (const fileId of scan.orphans) {
    try {
      collectedCount += await container.scopeUnitOfWorkProvider.run(
        input.scope,
        (ctx) => deleteStoredFiles(ctx, [fileId], null, now),
      );
    } catch (cause) {
      container.logger.error("[collectOrphanMedia] a file was left behind", {
        cause,
        fileId,
      });
    }
  }

  const hasMoreNow = scan.scanned === limit && collectedCount > 0;
  await container.scopeUnitOfWorkProvider.run(input.scope, (ctx) =>
    ctx.scopeTaskScheduler.schedule({
      kind: ORPHAN_MEDIA_TASK_KIND,
      operationId: ORPHAN_MEDIA_OPERATION_ID,
      priority: ScopeTaskPriority.expiryCollection,
      dueAt: hasMoreNow
        ? now
        : new Date(now.getTime() + ORPHAN_MEDIA_SWEEP_INTERVAL_MS),
      payload: {},
    }),
  );

  return { collectedCount };
}
