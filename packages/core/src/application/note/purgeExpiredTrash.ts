import type { TrashedNote } from "@repo/core/domain/note/note";
import type { RequestContainer } from "../di/types";
import { ScopeTaskPriority } from "../ports/scopeTaskScheduler";
import type { ScopeKey } from "../scope";

/**
 * Scope-task kind carrying the retention sweep of one scope's trash.
 *
 * The row is armed by `trashNote` at the earliest `purgeAfter` of the
 * scope and re-armed by a turn that came back full; a turn that finds
 * nothing left completes it, because the next deadline is only known to
 * the note that sets it.
 */
export const TRASH_EXPIRY_TASK_KIND = "note.trashExpiryContinued";

/**
 * The sweep is one per scope, not one per note or per run, so the row's
 * identity is a constant: a turn replayed after a lost response rewrites
 * the same row instead of leaving a second sweep behind.
 */
export const TRASH_EXPIRY_OPERATION_ID = "note.trashExpiry";

/**
 * Notes one turn reclaims. The cap bounds the CPU of a single alarm turn
 * and the `note.purged` fan-out it emits (spec/platform/index.md「実行
 * 予算と分割単位」).
 */
export const TRASH_EXPIRY_BATCH_SIZE = 100;

export type PurgeExpiredTrashInput = Readonly<{
  /** Scope whose alarm fired. The retention sweep is scope-local. */
  scope: ScopeKey;
  limit?: number;
}>;

export type PurgeExpiredTrashView = Readonly<{ purgedCount: number }>;

/**
 * Seam for the purge half of the retention sweep.
 *
 * The sweep is neither of the two admissions `purgeNote` offers. It has
 * no actor — nobody asked for it, so `userRequest`'s permission gate has
 * no one to evaluate and a workspace note has no member to name — and it
 * has no cleanup barrier, so `scopeCleanup`'s `assertOwner` refuses it.
 * Reaching the saga therefore takes a third admission kind on
 * `PurgeNoteInput`, one that keeps only the checks retention needs (the
 * note is in this scope, at the version the enumeration read) and skips
 * both the actor and the barrier.
 *
 * Until that kind exists the driver is supplied by the caller. That is
 * deliberate rather than defaulted to a no-op: a sweep whose default
 * silently purges nothing would keep expired notes forever while
 * reporting success.
 */
export type ExpiredNotePurge = (
  container: RequestContainer,
  target: Readonly<{
    noteId: string;
    expectedVersion: number;
    scope: ScopeKey;
  }>,
) => Promise<void>;

export type PurgeExpiredTrashArgs = Readonly<{
  container: RequestContainer;
  input: PurgeExpiredTrashInput;
  purge: ExpiredNotePurge;
}>;

/**
 * Reclaims the notes whose retention window has lapsed (UC-note-021,
 * ED-10).
 *
 * The deadline is the turn's own `now`, read once: `purgeAfter <= now`
 * is the whole predicate, so a note trashed while the turn runs is never
 * swept early and one that misses the window by a millisecond waits for
 * the next turn.
 *
 * The page is bounded and reaching a short one is the proof there is
 * nothing left, which is the only condition that settles the row. A full
 * page re-arms the sweep for immediately after, and so does a page some
 * of whose notes refused to be purged — leaving those behind while
 * settling the row would drop them until the next note happened to be
 * trashed. The one outcome that must not breed a continuation is a page
 * where nothing at all could be purged: that would spin on a permanently
 * failing note, so the row is backed off instead and the schedule owns
 * the retry.
 */
export async function purgeExpiredTrash({
  container,
  input,
  purge,
}: PurgeExpiredTrashArgs): Promise<PurgeExpiredTrashView> {
  const limit = Math.min(
    Math.max(1, input.limit ?? TRASH_EXPIRY_BATCH_SIZE),
    TRASH_EXPIRY_BATCH_SIZE,
  );
  const now = container.clock.now();

  const targets = await container.scopeUnitOfWorkProvider.run(
    input.scope,
    (ctx) => ctx.noteRepository.listPurgeable(now, limit),
  );
  const purgedCount = await purgeEachNote(
    container,
    input.scope,
    purge,
    targets,
  );

  await settle(container, input.scope, {
    targets: targets.length,
    purgedCount,
    full: targets.length === limit,
    now,
  });
  return { purgedCount };
}

async function purgeEachNote(
  container: RequestContainer,
  scope: ScopeKey,
  purge: ExpiredNotePurge,
  targets: readonly TrashedNote[],
): Promise<number> {
  let purgedCount = 0;
  for (const note of targets) {
    try {
      await purge(container, {
        noteId: note.id,
        expectedVersion: note.version,
        scope,
      });
      purgedCount += 1;
    } catch (cause) {
      container.logger.error("[purgeExpiredTrash] a note was left behind", {
        cause,
        noteId: note.id,
      });
    }
  }
  return purgedCount;
}

async function settle(
  container: RequestContainer,
  scope: ScopeKey,
  outcome: Readonly<{
    targets: number;
    purgedCount: number;
    full: boolean;
    now: Date;
  }>,
): Promise<void> {
  await container.scopeUnitOfWorkProvider.run(scope, async (ctx) => {
    if (outcome.targets > 0 && outcome.purgedCount === 0) {
      await ctx.scopeTaskScheduler.backoffOrSchedule({
        kind: TRASH_EXPIRY_TASK_KIND,
        operationId: TRASH_EXPIRY_OPERATION_ID,
        priority: ScopeTaskPriority.expiryCollection,
        payload: {},
        now: outcome.now,
      });
      return;
    }
    if (outcome.full || outcome.purgedCount < outcome.targets) {
      await ctx.scopeTaskScheduler.schedule({
        kind: TRASH_EXPIRY_TASK_KIND,
        operationId: TRASH_EXPIRY_OPERATION_ID,
        priority: ScopeTaskPriority.expiryCollection,
        dueAt: outcome.now,
        payload: {},
      });
      return;
    }
    await ctx.scopeTaskScheduler.complete(
      TRASH_EXPIRY_TASK_KIND,
      TRASH_EXPIRY_OPERATION_ID,
    );
  });
}
