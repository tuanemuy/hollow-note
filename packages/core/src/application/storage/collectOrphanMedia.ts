import { NoteRevision } from "@repo/core/domain/note/noteRevision";
import type { HtmlProcessor } from "@repo/core/domain/note/ports/htmlProcessor";
import type { NoteHtml, NoteId } from "@repo/core/domain/note/valueObject";
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
 * Files one turn inspects. The cap bounds the rows a single alarm turn
 * reads and the `storage.fileDeleted` fan-out it emits
 * (spec/platform/index.md「実行予算と分割単位」).
 *
 * It is a cap on rows *read*, not on rows collected, which is why the
 * turn cannot simply keep reading until it finds work.
 *
 * It does **not** bound the turn's CPU on its own: what costs CPU is a
 * body parse, and the number of those follows the number of distinct
 * notes on the page, not the number of files ({@link readNoteBodies}
 * reads the current body plus every retained revision, and
 * {@link decideOrphans} parses each of them). That bound is
 * {@link ORPHAN_MEDIA_NOTE_BUDGET}'s job.
 */
export const ORPHAN_MEDIA_BATCH_SIZE = 100;

/**
 * Distinct notes one turn reads bodies for.
 *
 * Each note costs a note read, a revision listing and up to
 * `NoteRevision.RETENTION + 1` body parses of up to `NoteHtml`'s
 * 800,000 bytes, so the page size alone leaves the turn's CPU unbounded:
 * a page whose 100 files belong to 100 notes would parse 2,100 bodies.
 * Five notes hold the worst case to 105 parses — the same order as one
 * parse per candidate, which is the cost
 * {@link ORPHAN_MEDIA_BATCH_SIZE} is sized against.
 *
 * A page is usually one note's pictures, so the budget is normally never
 * reached. When it is, the turn stops at the last file it judged and
 * continues from there immediately: the position advances, so the work
 * is postponed by a turn rather than lost. Lowering this value is not
 * free — a pass over files that stay scattered across notes costs
 * `limit / budget` times as many turns, since each turn then advances by
 * the budget rather than by the page.
 */
export const ORPHAN_MEDIA_NOTE_BUDGET = 5;

/**
 * Body characters one turn holds at once.
 *
 * {@link ORPHAN_MEDIA_NOTE_BUDGET} bounds the parses, not the memory:
 * five notes each holding `NoteRevision.RETENTION + 1` bodies of
 * `NoteHtml`'s 800,000 bytes is 84,000,000 characters resident at the
 * moment the scan transaction closes, well past what a Cloudflare
 * isolate has (spec/platform/index.md). This is the bound that answers
 * for the memory: the turn stops before reading a note it has no room
 * for, taking the same `outOfBudget` exit the note budget takes, so the
 * position still advances and the work is postponed rather than lost.
 *
 * It counts `String.length` rather than bytes because what is held is
 * the string, not its UTF-8 form, and V8 stores one in a one-byte or a
 * two-byte representation depending on its content — so the same count
 * is worth between one and two bytes a character. The value is chosen
 * with that spread already paid for: the check is made before a note is
 * read, so the worst case is this budget plus one whole note
 * (21 × 800,000 = 16,800,000) ≈ 33,000,000 characters, which is 33 MB
 * narrow and 66 MB wide. A quarter of the isolate at one byte leaves
 * the doubling covered.
 *
 * A turn always reads at least one note: nothing has been held when the
 * first is considered, so no scope can be stalled by a note too large
 * for the budget.
 */
export const ORPHAN_MEDIA_BODY_BUDGET_CHARS = 16_000_000;

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
   * Position the next turn resumes from, or `null` when the pass walked
   * the listing out and the next one starts at the head again.
   *
   * A turn that failed answers with the position it started from, not
   * `null`: the row went back to the daily cadence, but it kept its place
   * in the walk.
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
 *
 * `fromPayload` is what lets the caller report that fallback
 * (`spec/domains/index.md#継続要求`) without warning on every ordinary
 * turn: the head of a pass is written as a payload naming no position at
 * all ({@link sweepPayload} of `null`), which is the daily cadence's own
 * shape, so only a payload that names a position and still yields none
 * is a loss.
 */
export const readOrphanMediaSweepTurn = (
  payload: ScopeTaskPayload,
): Readonly<{
  cursor: StoredFilePurposeCursor | null;
  fromPayload: boolean;
}> => {
  const createdAt = payload[CURSOR_CREATED_AT];
  const id = payload[CURSOR_ID];
  const names = createdAt !== undefined || id !== undefined;
  if (
    typeof createdAt !== "string" ||
    typeof id !== "string" ||
    id.trim().length === 0
  ) {
    return { cursor: null, fromPayload: !names };
  }
  const at = new Date(createdAt);
  if (Number.isNaN(at.getTime())) {
    return { cursor: null, fromPayload: false };
  }
  return {
    cursor: { createdAt: at, id: StoredFileId.create(id) },
    fromPayload: true,
  };
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
 * What one note has to say about the media it owns.
 *
 * `gone` is terminal, so the note's media is collectable. `unreadable`
 * is the opposite: a note whose content is not `ready` has no body to
 * read, and "no body" is not evidence a reference was dropped, so its
 * media is spared until the body comes back.
 */
type NoteReferences =
  | Readonly<{ kind: "gone" }>
  | Readonly<{ kind: "unreadable" }>
  | Readonly<{ kind: "urls"; urls: readonly string[] }>;

/**
 * The same three answers before anything has been parsed: the bodies one
 * note holds, read but not yet inspected.
 *
 * Splitting the answer in two is what keeps the parse out of the
 * transaction ({@link sweepOnce}). Reading is the only half that needs
 * the scope's tables; deciding is a pure function of these strings.
 */
type NoteBodies =
  | Readonly<{ kind: "gone" }>
  | Readonly<{ kind: "unreadable" }>
  | Readonly<{ kind: "bodies"; htmls: readonly NoteHtml[] }>;

/**
 * Every body one note still holds — the one it shows now, and each
 * revision that can still be restored.
 *
 * The revisions are part of the answer because a revision is a *live*
 * reference: `restoreNoteRevision` puts one of the newest
 * {@link NoteRevision.RETENTION} bodies back verbatim, and the sweep
 * measures age from creation. Reading the current body alone therefore
 * collects a picture that "insert, drop from the body the next day,
 * sweep 29 days later" leaves a restorable revision pointing at — the
 * restore succeeds and the image 404s. Twenty saved bodies span months,
 * so this is the ordinary case, not a corner of one.
 *
 * The read is per *note*, not per file, and the caller holds the answer
 * for the rest of the turn: a page is usually one note's pictures, and
 * reading its bodies once is what keeps the revisions from multiplying
 * the turn's work by the retention depth. Memoization is not itself a
 * bound, though — a page spread over as many notes as it has files
 * memoizes nothing — which is why the caller also caps how many notes one
 * turn reads ({@link ORPHAN_MEDIA_NOTE_BUDGET}). That cap bounds the
 * parses; what the caller holds in memory is bounded separately, by
 * {@link ORPHAN_MEDIA_BODY_BUDGET_CHARS}, since five notes' worth of
 * retained bodies is far more than an isolate can carry.
 */
async function readNoteBodies(
  ctx: ScopeUnitOfWorkContext,
  noteId: NoteId,
): Promise<NoteBodies> {
  const versioned = await ctx.noteRepository.findById(noteId);
  if (versioned === null) {
    return { kind: "gone" };
  }
  const content = versioned.entity.content;
  if (content.status !== "ready") {
    return { kind: "unreadable" };
  }
  const revisions = await ctx.noteRevisionRepository.listByNote(
    noteId,
    NoteRevision.RETENTION,
  );
  return {
    kind: "bodies",
    htmls: [content.html, ...revisions.map((revision) => revision.html)],
  };
}

/**
 * The addresses those bodies name. Pure, and deliberately run outside the
 * transaction that read them ({@link sweepOnce}).
 *
 * `extractExternalReferences` is deliberately not filtered through
 * `StorageUrlPolicy.isInternal` — an internal storage URL is exactly what
 * is being looked for (spec/usecases/storage.md#collectorphanmedia).
 */
const referencesOf = (
  container: OrphanMediaContainer,
  bodies: NoteBodies,
): NoteReferences =>
  bodies.kind === "bodies"
    ? {
        kind: "urls",
        urls: bodies.htmls.flatMap((html) =>
          container.htmlProcessor
            .extractExternalReferences(html)
            .map((reference) => reference.url),
        ),
      }
    : bodies;

/**
 * Decides one candidate against what its own note holds.
 *
 * The owning note comes from `FileProvenance.noteId`, which `media`
 * carries by construction, so nothing has to search bodies for the file.
 * That is also why another note referencing the same URL does not save
 * it: the sweep asks whether *this* note still uses it.
 */
const isOrphan = (
  container: OrphanMediaContainer,
  references: NoteReferences,
  objectKey: ObjectKey,
): boolean => {
  if (references.kind !== "urls") {
    return references.kind === "gone";
  }
  const fileUrl = container.objectStorage.publicUrl(objectKey);
  return !references.urls.some((url) => addressesSameObject(url, fileUrl));
};

/**
 * One candidate the read transaction got as far as: the file, and the
 * bodies of the note that owns it. Everything needed to decide it, and
 * nothing that needs the scope's tables again.
 */
type JudgedCandidate = Readonly<{
  id: StoredFileId;
  objectKey: ObjectKey;
  noteId: NoteId;
  bodies: NoteBodies;
}>;

/**
 * Turns the bodies the transaction read into the list of files to
 * delete. Runs **outside** the transaction: parsing a body is where this
 * turn spends its CPU (up to `RETENTION + 1` bodies per note of up to
 * `NoteHtml`'s 800,000 bytes each), and holding the scope open across
 * that stalls every other request to the same scope object
 * (spec/platform/index.md「実行予算と分割単位」).
 *
 * Moving it out costs no consistency: the reads that feed the decision —
 * the listing, the note and its revisions — all happened inside the one
 * transaction, and what is left here is a pure function of their result.
 *
 * A body that will not parse spares its file and the walk carries on,
 * for the same reason a failed read does: losing the turn would stall
 * the cursor on this page and hide everything behind it.
 */
const decideOrphans = (
  container: OrphanMediaContainer,
  judged: readonly JudgedCandidate[],
): readonly StoredFileId[] => {
  const byNote = new Map<string, NoteReferences>();
  const orphans: StoredFileId[] = [];
  for (const candidate of judged) {
    try {
      let references = byNote.get(candidate.noteId);
      if (references === undefined) {
        references = referencesOf(container, candidate.bodies);
        byNote.set(candidate.noteId, references);
      }
      if (isOrphan(container, references, candidate.objectKey)) {
        orphans.push(candidate.id);
      }
    } catch (cause) {
      container.logger.error(
        "[collectOrphanMedia] a file could not be judged",
        { cause, fileId: candidate.id },
      );
    }
  }
  return orphans;
};

/**
 * Reclaims media that no body references any more (UC-storage-010,
 * spec/usecases/storage.md#collectorphanmedia).
 *
 * Collection needs both conditions: old enough *and* unreferenced. The
 * age is the listing's own predicate, so a young file is never even
 * inspected, and the boundary is inclusive — a file created exactly
 * `now - 30 days` is in the page. "Unreferenced" spans the note's whole
 * restorable history, not just the body it shows now
 * ({@link readNoteBodies}).
 *
 * No turn ever settles the row as `failed`: a turn that cannot finish
 * logs and re-arms itself for the next day, keeping the position it
 * started from so the failure costs a day rather than the walk. The
 * sweep is the only thing that keeps its own row alive, so parking it is
 * not a retry ceiling but the end of collection in that scope.
 *
 * The listing walks the whole scope rather than one owner's files, which
 * is why it is `listByPurposeOlderThan` and not `listByOwner`: a scope's
 * media belongs to whoever uploaded it and the sweep has no owner to
 * filter by.
 *
 * A turn is three stages, and only the first and the last touch the
 * scope: one transaction reads the page and the bodies of the notes it
 * names, {@link decideOrphans} parses those bodies outside any
 * transaction, and each deletion is then a transaction of its own,
 * because one file that cannot be removed must not take the rest of the
 * page down with it (spec's「個々の失敗は記録して継続」).
 *
 * The row is then moved rather than completed, and what decides where to
 * is the **listing**, not the harvest: a full page — or a page the note
 * budget cut short ({@link ORPHAN_MEDIA_NOTE_BUDGET}) — means there is
 * more to inspect, so the row is re-armed for immediately after carrying
 * the position of the last file judged, and a page walked out to its end
 * means the listing is out, so the row goes back to the next day with the
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
  const now = container.clock.now();
  try {
    return await sweepOnce(container, input, now);
  } catch (cause) {
    // The sweep row is the scope's only one and nothing else re-arms it:
    // `armOrphanMediaSweepOnFirstMedia` fires on "the scope holds no
    // media", which a scope that has media never satisfies again. Letting
    // a turn throw hands the row to the runner's backoff, and a failure
    // that does not clear — an unreadable body, a listing the backend
    // keeps refusing — walks it to the attempt ceiling and parks it as
    // `failed`, ending that scope's collection for good. A periodic
    // full-scope sweep has a cheaper answer available: skip this turn and
    // take the loss, the same reasoning `readOrphanMediaSweepTurn`
    // applies to a payload it cannot read.
    container.logger.error(
      "[collectOrphanMedia] the turn failed; re-armed for the next day",
      { cause, scope: input.scope },
    );
    // The position this turn started from is kept, not cleared. Clearing
    // it sends the next turn back to the head of the listing, and a page
    // that fails for a reason that does not clear — a body the parser
    // keeps refusing, a scope whose listing keeps timing out — is then
    // re-read every day forever, so nothing behind it is ever inspected.
    // Keeping it costs at most one repeated page once the obstacle
    // clears, and the pass still returns to the head as soon as a turn
    // walks the listing out.
    const kept = input.cursor ?? null;
    await armDailySweep(container, input.scope, now, kept);
    return { collectedCount: 0, nextCursor: kept };
  }
}

/**
 * Puts the sweep row back on its daily cadence, resuming from `cursor`
 * (`null` — the ordinary end of a pass — starts the next one at the head).
 */
const armDailySweep = (
  container: OrphanMediaContainer,
  scope: ScopeKey,
  now: Date,
  cursor: StoredFilePurposeCursor | null = null,
): Promise<void> =>
  container.scopeUnitOfWorkProvider.run(scope, (ctx) =>
    ctx.scopeTaskScheduler.schedule({
      kind: ORPHAN_MEDIA_TASK_KIND,
      operationId: ORPHAN_MEDIA_OPERATION_ID,
      priority: ScopeTaskPriority.expiryCollection,
      dueAt: new Date(now.getTime() + ORPHAN_MEDIA_SWEEP_INTERVAL_MS),
      payload: sweepPayload(cursor),
    }),
  );

async function sweepOnce(
  container: OrphanMediaContainer,
  input: CollectOrphanMediaInput,
  now: Date,
): Promise<CollectOrphanMediaView> {
  const limit = Math.min(
    Math.max(1, input.limit ?? ORPHAN_MEDIA_BATCH_SIZE),
    ORPHAN_MEDIA_BATCH_SIZE,
  );
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
      const judged: JudgedCandidate[] = [];
      // One read per note for the whole page: a page is usually one
      // note's pictures, and each answer costs a note read and a revision
      // listing.
      const byNote = new Map<string, NoteBodies>();
      // The position of the last file this turn actually judged, which
      // is where the next one resumes. It is not simply the page's last
      // row, because either budget can stop the walk mid-page.
      let judgedThrough: StoredFilePurposeCursor | null = null;
      let notesRead = 0;
      let charsHeld = 0;
      let outOfBudget = false;
      for (const file of candidates) {
        const noteId = file.noteId;
        // `media` provenance carries its note by construction; the guard
        // is the listing contract restated where it is relied on.
        if (file.purpose === "media" && noteId !== null) {
          let bodies = byNote.get(noteId);
          if (
            bodies === undefined &&
            (notesRead >= ORPHAN_MEDIA_NOTE_BUDGET ||
              charsHeld >= ORPHAN_MEDIA_BODY_BUDGET_CHARS)
          ) {
            // Stopping here rather than reading one more note is what
            // bounds the turn's cost — its parses by the first budget,
            // the bodies it keeps resident by the second.
            // `judgedThrough` has advanced over everything decided so
            // far, so the continuation picks up behind this file instead
            // of re-reading the page.
            outOfBudget = true;
            break;
          }
          if (bodies === undefined) {
            try {
              // Counted before the read, not after it: a note whose read
              // keeps failing is retried by every file that names it, and
              // counting attempts is what keeps that bounded too.
              notesRead += 1;
              bodies = await readNoteBodies(ctx, noteId);
              byNote.set(noteId, bodies);
              if (bodies.kind === "bodies") {
                charsHeld += bodies.htmls.reduce(
                  (total, html) => total + html.length,
                  0,
                );
              }
            } catch (cause) {
              // Spares the file and carries on. This transaction only
              // reads, so a failed read leaves nothing half-written, and
              // the alternative — losing the turn — would stall the
              // cursor on this page and hide everything behind it
              // forever.
              container.logger.error(
                "[collectOrphanMedia] a file could not be judged",
                { cause, fileId: file.id },
              );
            }
          }
          if (bodies !== undefined) {
            judged.push({
              id: file.id,
              objectKey: file.objectKey,
              noteId,
              bodies,
            });
          }
        }
        judgedThrough = { createdAt: file.createdAt, id: file.id };
      }
      return {
        pageFull: candidates.length === limit,
        outOfBudget,
        judged,
        last: judgedThrough,
      };
    },
  );

  const orphans = decideOrphans(container, scan.judged);

  let collectedCount = 0;
  for (const fileId of orphans) {
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

  const nextCursor = scan.pageFull || scan.outOfBudget ? scan.last : null;
  if (nextCursor === null) {
    await armDailySweep(container, input.scope, now);
  } else {
    await container.scopeUnitOfWorkProvider.run(input.scope, (ctx) =>
      ctx.scopeTaskScheduler.schedule({
        kind: ORPHAN_MEDIA_TASK_KIND,
        operationId: ORPHAN_MEDIA_OPERATION_ID,
        priority: ScopeTaskPriority.expiryCollection,
        dueAt: now,
        payload: sweepPayload(nextCursor),
      }),
    );
  }

  return { collectedCount, nextCursor };
}
