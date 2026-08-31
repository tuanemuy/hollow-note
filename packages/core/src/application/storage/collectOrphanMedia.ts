import type { HtmlProcessor } from "@repo/core/domain/note/ports/htmlProcessor";
import type { NoteId } from "@repo/core/domain/note/valueObject";
import type { StoredFilePurposeCursor } from "@repo/core/domain/storage/ports/storedFileRepository";
import {
  type ObjectKey,
  StoredFileId,
} from "@repo/core/domain/storage/valueObject";
import type { SharedDeps } from "../di/types";
import type {
  ScopeUnitOfWorkContext,
  ScopeUnitOfWorkProvider,
} from "../execution/unitOfWork";
import type { ObjectStorage } from "../ports/objectStorage";
import {
  type ScopeTaskPayload,
  ScopeTaskPriority,
} from "../ports/scopeTaskScheduler";
import type { ScopeKey } from "../scope";
import { deleteStoredFiles } from "./deleteFiles";

/**
 * Scope-task kind carrying the orphan-media sweep of one scope.
 *
 * The row is armed by the first media that appears in the scope
 * ({@link armOrphanMediaSweepOnFirstMedia}) and moved by every turn — to
 * immediately after while the listing still has a page behind the one
 * just read, and to the next day once it is walked out. It is never
 * completed: the sweep is periodic, and a scope that once held media can
 * grow an orphan again at any time.
 *
 * Its payload carries the keyset position the next turn resumes from
 * ({@link readOrphanMediaSweepTurn}), which is what keeps the walk
 * moving past rows the sweep decides to spare.
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
 *
 * It is a cap on rows *read*, not on rows collected, which is why the
 * turn cannot simply keep reading until it finds work.
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
  /**
   * Keyset position the previous turn stopped at; `null` (the default)
   * starts a fresh pass at the oldest media in the scope.
   */
  cursor?: StoredFilePurposeCursor | null;
}>;

export type CollectOrphanMediaView = Readonly<{
  collectedCount: number;
  /**
   * Position handed to the continuation, or `null` when the pass walked
   * the listing out and the row went back to its daily cadence.
   */
  nextCursor: StoredFilePurposeCursor | null;
}>;

const CURSOR_CREATED_AT = "afterCreatedAt";
const CURSOR_ID = "afterId";

/**
 * Reads back the keyset position {@link collectOrphanMedia} wrote into
 * its own task payload.
 *
 * A payload that does not carry a readable position yields `null` — a
 * fresh pass from the head — rather than an error. Unlike a note-purge
 * continuation, whose payload names the one note it exists to clean up,
 * this one is a *resumption hint* for a periodic sweep over the whole
 * scope: restarting from the head repeats work but loses none, whereas
 * throwing would back the row off and, at the attempt ceiling, park the
 * scope's only sweep as `failed` with nothing left to re-arm it.
 */
export const readOrphanMediaSweepTurn = (
  payload: ScopeTaskPayload,
): Readonly<{ cursor: StoredFilePurposeCursor | null }> => {
  const createdAt = payload[CURSOR_CREATED_AT];
  const id = payload[CURSOR_ID];
  if (
    typeof createdAt !== "string" ||
    typeof id !== "string" ||
    id.trim().length === 0
  ) {
    return { cursor: null };
  }
  const at = new Date(createdAt);
  if (Number.isNaN(at.getTime())) {
    return { cursor: null };
  }
  return { cursor: { createdAt: at, id: StoredFileId.create(id) } };
};

const sweepPayload = (
  cursor: StoredFilePurposeCursor | null,
): ScopeTaskPayload =>
  cursor === null
    ? {}
    : {
        [CURSOR_CREATED_AT]: cursor.createdAt.toISOString(),
        [CURSOR_ID]: cursor.id,
      };

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
    null,
  );
  if (existing.length > 0) {
    return;
  }
  await ctx.scopeTaskScheduler.schedule({
    kind: ORPHAN_MEDIA_TASK_KIND,
    operationId: ORPHAN_MEDIA_OPERATION_ID,
    priority: ScopeTaskPriority.expiryCollection,
    dueAt: new Date(now.getTime() + ORPHAN_MEDIA_SWEEP_INTERVAL_MS),
    payload: sweepPayload(null),
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
 * The row is then moved rather than completed, and what decides where to
 * is the **listing**, not the harvest: a full page means there may be
 * another behind it, so the row is re-armed for immediately after
 * carrying the keyset position of the page's last row, and a short page
 * means the walk is out, so the row goes back to the next day with the
 * position cleared. Tying the continuation to "did this turn collect
 * anything" instead is what stalls the sweep: the rows it spares stay
 * where they are, so a scope whose oldest `limit` media are all still
 * referenced — an ordinary busy scope — would re-read that same page
 * every day and never inspect anything behind it. The cursor is also
 * what keeps the immediate re-arm from spinning: it advances strictly,
 * over a finite listing, so the chain of immediate turns ends.
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
        input.cursor ?? null,
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
      const last = candidates[candidates.length - 1];
      return {
        scanned: candidates.length,
        orphans,
        last:
          last === undefined
            ? null
            : { createdAt: last.createdAt, id: last.id },
      };
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

  const nextCursor = scan.scanned === limit ? scan.last : null;
  await container.scopeUnitOfWorkProvider.run(input.scope, (ctx) =>
    ctx.scopeTaskScheduler.schedule({
      kind: ORPHAN_MEDIA_TASK_KIND,
      operationId: ORPHAN_MEDIA_OPERATION_ID,
      priority: ScopeTaskPriority.expiryCollection,
      dueAt:
        nextCursor === null
          ? new Date(now.getTime() + ORPHAN_MEDIA_SWEEP_INTERVAL_MS)
          : now,
      payload: sweepPayload(nextCursor),
    }),
  );

  return { collectedCount, nextCursor };
}
