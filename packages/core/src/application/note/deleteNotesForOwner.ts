import type { Note } from "@repo/core/domain/note/note";
import { NoteId, NoteOwner } from "@repo/core/domain/note/valueObject";
import { NOTE_OWNER_PURGE_TASK_KIND } from "../cleanup/participants";
import {
  completePersonalCleanupIfDone,
  type ScopeCleanupTurn,
} from "../cleanup/personalCleanup";
import type { NotePurgeContainer } from "../di/types";
import { SystemError, SystemErrorCode } from "../errors";
import {
  type ScopeTaskPayload,
  ScopeTaskPriority,
} from "../ports/scopeTaskScheduler";
import type { ScopeKey } from "../scope";
import { purgeNoteInternally } from "./purgeNote";

export { NOTE_OWNER_PURGE_TASK_KIND };

/**
 * Notes one turn purges (spec/platform/index.md「実行予算と分割単位」,
 * owner / workspace cleanup).
 *
 * The cap bounds three quantities at once: the CPU of a single alarm
 * turn, the `note.purged` fan-out it emits, and — unlike the other rows
 * of that table — the *global* queries the turn spends. A purge is a
 * saga over the global route and the global public projection, so this
 * is the one scope cleanup whose global query count grows with the
 * batch, and the global budget is what decides the value: the table's
 * 100 rows would spend around 1,200 statements, past the section's
 * 500-query design ceiling and past the real 1,000 as well.
 *
 * The unit is a *statement*, not a port call. Each of the four global
 * calls a purge makes reads its row and then writes an atomic apply led
 * by a guard pinning that row, so `resolve` costs 1, `beginPurge` 3,
 * `removeForPurge` 4–5 and `finishPurge` 3 — eleven to twelve per note,
 * which the resume and abort branches do not exceed. Forty notes leave
 * the turn at 480, and lowering `batchSize` — not raising it — is the
 * adjustment a deployment has.
 *
 * The cap is on the notes of a turn, not on the page alone. The carried
 * {@link StuckPurge} entries ride on top of the page, so the page is
 * read `batchSize - carried.length` wide and 480 is a ceiling a
 * recovering turn cannot exceed either — which is what makes it one: a
 * carried id has already left every enumeration, so an outage that keeps
 * failing the same purges would otherwise grow the list without bound.
 */
export const OWNER_PURGE_BATCH_SIZE = 40;

/**
 * A note this cleanup claimed but could not carry to a tombstone.
 *
 * `beginPurge` closes the route, and from that moment the note is
 * outside every enumeration this usecase has: `NoteRouteStore.resolve`
 * hides a `purging` row, the store cannot list them, and once the local
 * delete commits `listByOwner` does not return the note either. A purge
 * that stops in that window is therefore reachable only by note id,
 * which is why the continuation carries one — without it the next turn
 * enumerates nothing, concludes the scope is empty and acknowledges the
 * `note` component over a note whose public projection is still
 * standing.
 *
 * The version travels with the id because the closed route is also what
 * makes it durable: nothing can edit a note whose route does not
 * resolve, so the version the stuck turn read is still the version its
 * resume needs. It is consulted only when the local delete did *not*
 * commit — once it has, the resumed purge finds no row and carries the
 * saga forward without asking for a version at all.
 */
export type StuckPurge = Readonly<{
  noteId: NoteId;
  expectedVersion: number;
}>;

const STUCK_PURGES = "stuckPurges";

const corrupt = (detail: string): SystemError =>
  new SystemError(
    SystemErrorCode.DataIntegrityError,
    `Owner purge continuation: ${detail}`,
  );

/**
 * Reads the stuck purges a continuation carries.
 *
 * The list names the work itself — notes that have left every
 * enumeration this usecase has — so an entry that does not parse faults
 * the turn (`spec/domains/index.md#継続要求`). Dropping it would leave
 * the turn enumerating nothing, and an empty enumeration is how this
 * usecase concludes the scope is clean: the `note` component would be
 * acknowledged over a note whose public projection is still standing,
 * which no later turn can take back.
 *
 * The faulted turn leaves the row behind and the runner backs it off, so
 * `dueAt` moves forward with every attempt and the row parks as `failed`
 * once `SCOPE_TASK_MAX_ATTEMPTS` is reached, after which nothing claims
 * it and only `schedule` brings it back. What makes the stall visible is
 * therefore the runner's `[scope-tasks] task threw` log and the `failed`
 * row — not a `dueAt` ageing in place, which a backed-off row never
 * does.
 */
export const readOwnerPurgeTurn = (
  payload: ScopeTaskPayload,
): Readonly<{ stuckPurges: readonly StuckPurge[] }> => {
  const raw = payload[STUCK_PURGES];
  if (raw === undefined || raw === null) {
    return { stuckPurges: [] };
  }
  if (!Array.isArray(raw)) {
    throw corrupt(`${STUCK_PURGES} is not a list`);
  }
  const stuckPurges: StuckPurge[] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) {
      throw corrupt(`${STUCK_PURGES} holds an entry that is not an object`);
    }
    const { noteId, expectedVersion } = entry as Record<string, unknown>;
    // Trimmed, not merely non-empty: `NoteId.create` accepts exactly the
    // strings that survive a trim, so anything else has to be answered
    // here rather than reach the value object as a `BusinessRuleError`.
    if (typeof noteId !== "string" || noteId.trim().length === 0) {
      throw corrupt(`${STUCK_PURGES} holds an entry naming no note`);
    }
    if (
      typeof expectedVersion !== "number" ||
      !Number.isInteger(expectedVersion)
    ) {
      throw corrupt(
        `${STUCK_PURGES} entry ${noteId} carries no readable version`,
      );
    }
    stuckPurges.push({ noteId: NoteId.create(noteId), expectedVersion });
  }
  return { stuckPurges };
};

export type DeleteNotesForOwnerInput = Readonly<{
  deletionOperationId: string;
  /**
   * Scope the cleanup is walking. A personal deletion names the leaving
   * user's own scope and therefore never reaches the workspace notes
   * they authored (AC-09).
   *
   * A workspace scope is accepted by the same rule — it would name the
   * workspace and never reach its members' personal notes — but nothing
   * drives it yet: `application/workspace/workspaceDeletionLocal.ts`
   * retires memberships, invitations and the Workspace row without
   * purging notes, so the only caller today is the personal cleanup.
   * That is also why the `note.purged` fan-out's admission reads the
   * personal receipt alone
   * (`application/cleanup/notePurgeFanOut.ts`).
   */
  scope: ScopeKey;
  batchSize?: number;
  /**
   * Purges an earlier turn left unfinished, carried by the continuation
   * that turn armed ({@link StuckPurge}). Empty on the command that
   * opens the cleanup.
   */
  stuckPurges?: readonly StuckPurge[];
}>;

export type DeleteNotesForOwnerView = ScopeCleanupTurn &
  Readonly<{ purgedCount: number }>;

export type DeleteNotesForOwnerArgs = Readonly<{
  container: NotePurgeContainer;
  input: DeleteNotesForOwnerInput;
}>;

/** One note this turn drives, and where the turn found it. */
type PurgeTarget = StuckPurge & Readonly<{ enumerated: boolean }>;

type TurnOutcome = Readonly<{
  /** Targets that reached a tombstone, wherever they came from. */
  purgedCount: number;
  /** Of those, the ones `listByOwner` returned — what `count` shrinks by. */
  purgedFromPage: number;
  stuckPurges: readonly StuckPurge[];
}>;

/**
 * Purges every note of one scope on behalf of a deletion (UC-note-022,
 * spec/usecases/note.md#deletenotesforowner).
 *
 * Lifecycle is not a filter: an account or workspace that is going away
 * takes its trash with it, so the enumeration reads `"all"` and the
 * purge is driven per note through `purgeNote`'s cleanup path, which
 * admits an active note and a departed membership alike.
 *
 * There is no cursor. Each turn destroys what it read, so reading from
 * the start always moves forward, and two continuations racing on the
 * same scope converge: whichever claims a note's route first purges it,
 * and the other finds it gone. This is also why a redelivered command is
 * free — the second pass enumerates nothing.
 *
 * Purging note by note rather than deleting the owner's rows in bulk is
 * what carries the cross-domain cleanup: tag assignments, stored files
 * and backup records hold no foreign key to the note and are reclaimed
 * off `note.purged` (ADR 008). A backup record does not even carry an
 * owner column, so once the note is gone there is no way left to find
 * it.
 *
 * **The component is acknowledged on tombstones, not on an empty
 * enumeration.** A purge that stops after its route is claimed leaves
 * nothing for `listByOwner` to return, so "the listing is empty" would
 * close the deletion's `note` barrier over a note whose public row is
 * still readable and whose fan-out never ran — irreversibly, since the
 * closed barrier refuses every later cleanup command. The turn keeps
 * the ids it could not finish ({@link StuckPurge}) and re-drives them
 * next turn instead, and acknowledges only once the enumeration is
 * exhausted *and* nothing is left stuck.
 *
 * "Targets remain but none could be purged" is the one outcome that must
 * not breed a continuation — it would spin on a permanently failing
 * note. The turn backs its own row off instead and leaves the retry to
 * the schedule. A turn that got *newly* stuck is not that case even
 * though it purged nothing: it has an id to hand on that the existing
 * row's payload does not carry, and `backoffOrSchedule` keeps an
 * existing row's payload. Discovering a note is stuck happens at most
 * once per note, so re-arming there cannot spin. Zero targets is the
 * opposite of both: the work is finished, so the component is
 * acknowledged and the row completed.
 *
 * The continuation cannot share the transaction of the batch's last
 * delete: a purge is a saga over three stores (route, scope, public
 * projection) that owns its own transactions, and nesting `run` is
 * forbidden. It is armed in transactions of its own — one the moment a
 * note is found stuck, and one at the end of the turn that settles the
 * row. Losing the settling one costs only the *narrowing* of a payload
 * the row already carries, which is why the ack cannot outrun the ids:
 * they were written before it. What no write can cover is a process that
 * dies between a purge's own commit and the detection that follows it —
 * the residue named in spec/usecases/note.md#deletenotesforowner, closed
 * only by a driver that can walk the routes of a scope.
 */
export async function deleteNotesForOwner({
  container,
  input,
}: DeleteNotesForOwnerArgs): Promise<DeleteNotesForOwnerView> {
  const batchSize = Math.min(
    Math.max(1, input.batchSize ?? OWNER_PURGE_BATCH_SIZE),
    OWNER_PURGE_BATCH_SIZE,
  );
  const owner = ownerOfScope(input.scope);

  // Asked before anything is read: a command from an operation that no
  // longer owns this scope must not enumerate it, let alone purge it.
  // The enumeration shares that transaction rather than taking a read
  // view of its own — the scope's repository is the one surface both
  // planes reach, and a purge has to be drivable from either.
  const carried = input.stuckPurges ?? [];
  // The carried ids ride on top of the page, so the page is what has to
  // make room for them: `batchSize` is a bound on the notes of one turn,
  // not on one of its two sources. Reading a full page beside them would
  // make the turn `batchSize + carried.length` notes wide, and since a
  // carried id has already left every enumeration, an outage that keeps
  // failing `removeForPurge` grows that list by up to `batchSize` per
  // turn with nothing to shrink it — an unbounded turn, and an unbounded
  // continuation payload with it. A page of zero is the right read when
  // the carried ids already fill the turn: `count` still answers whether
  // the enumeration has more, which is what decides the continuation.
  const page = await container.scopeUnitOfWorkProvider.run(
    input.scope,
    async (ctx) => {
      await ctx.cleanupAdmission.assertOwner(input.deletionOperationId);
      return ctx.noteRepository.listByOwner(owner, "all", {
        page: 1,
        limit: Math.max(0, batchSize - carried.length),
      });
    },
  );
  const targets = targetsOf(page.items, carried);
  const outcome = await purgeEachNote(container, input, targets);

  return settle(container, input, {
    ...outcome,
    targets: targets.length,
    remaining: page.count,
    newlyStuck: outcome.stuckPurges.some(
      (stuck) => !carried.some((entry) => entry.noteId === stuck.noteId),
    ),
  });
}

/**
 * The page first, then the stuck purges the page did not already offer.
 * A note that is both is driven at the version just read: the listing
 * saw the note this turn, the carried entry saw it on an earlier one.
 */
const targetsOf = (
  items: readonly Note[],
  carried: readonly StuckPurge[],
): readonly PurgeTarget[] => {
  const targets: PurgeTarget[] = items.map((note) => ({
    noteId: note.id,
    expectedVersion: note.version,
    enumerated: true,
  }));
  const seen = new Set<string>(targets.map((target) => target.noteId));
  for (const entry of carried) {
    if (!seen.has(entry.noteId)) {
      seen.add(entry.noteId);
      targets.push({ ...entry, enumerated: false });
    }
  }
  return targets;
};

/**
 * One note's failure is recorded and left behind: the notes of a scope
 * are unrelated, and stopping would strand the rest of the scope on a
 * single stuck route. The redelivery or the next continuation reads it
 * again from the start — or, when the route no longer resolves, from
 * the id this turn hands on.
 *
 * **A newly stuck id is written where it can be read back before the
 * loop moves on**, rather than at the end of the turn. It is the only
 * thing this usecase produces that a redelivery cannot reconstruct: the
 * note is out of every enumeration, so an id that exists nowhere but in
 * this turn's memory dies with the turn, and the next one reads an empty
 * scope and acknowledges the `note` component irreversibly. Settling
 * only rewrites what the row already carries.
 */
async function purgeEachNote(
  container: NotePurgeContainer,
  input: DeleteNotesForOwnerInput,
  targets: readonly PurgeTarget[],
): Promise<TurnOutcome> {
  let purgedCount = 0;
  let purgedFromPage = 0;
  // Seeded with what the continuation already carries, so a write from
  // inside the loop can never narrow the row: an entry leaves only by
  // being purged, and an id the turn has not reached yet is still stuck.
  const pending = new Map<string, StuckPurge>(
    (input.stuckPurges ?? []).map((entry) => [String(entry.noteId), entry]),
  );
  for (const target of targets) {
    const key = String(target.noteId);
    try {
      await purgeNoteInternally({
        container,
        input: {
          kind: "scopeCleanup",
          noteId: target.noteId,
          expectedVersion: target.expectedVersion,
          scope: input.scope,
          deletionOperationId: input.deletionOperationId,
        },
      });
      purgedCount += 1;
      pending.delete(key);
      if (target.enumerated) {
        purgedFromPage += 1;
      }
    } catch (cause) {
      container.logger.error("[deleteNotesForOwner] a note was left behind", {
        cause,
        noteId: target.noteId,
        deletionOperationId: input.deletionOperationId,
      });
      if (!(await isOutOfReach(container, target.noteId))) {
        // Still resolvable, so the next turn meets it the ordinary way.
        pending.delete(key);
        continue;
      }
      if (pending.has(key)) {
        continue;
      }
      pending.set(key, {
        noteId: target.noteId,
        expectedVersion: target.expectedVersion,
      });
      await armStuckPurges(container, input, [...pending.values()]);
    }
  }
  return {
    purgedCount,
    purgedFromPage,
    stuckPurges: [...pending.values()],
  };
}

/**
 * Upserts the continuation row with the ids this turn cannot lose.
 *
 * Its own failure is logged rather than thrown: the turn is worth
 * finishing for the notes it can still purge, and a throw would leave
 * exactly the same ids unwritten. The transaction is opened here, one
 * note at a time, because a purge owns transactions of its own and
 * nesting `run` is forbidden — there is no enclosing unit this could
 * join.
 */
async function armStuckPurges(
  container: NotePurgeContainer,
  input: DeleteNotesForOwnerInput,
  stuckPurges: readonly StuckPurge[],
): Promise<void> {
  try {
    await container.scopeUnitOfWorkProvider.run(input.scope, (ctx) =>
      ctx.scopeTaskScheduler.schedule({
        kind: NOTE_OWNER_PURGE_TASK_KIND,
        operationId: input.deletionOperationId,
        priority: ScopeTaskPriority.securityCleanup,
        dueAt: container.clock.now(),
        payload: continuationPayload(input.deletionOperationId, stuckPurges),
      }),
    );
  } catch (cause) {
    container.logger.error(
      "[deleteNotesForOwner] a stuck purge could not be armed for the next turn",
      {
        cause,
        deletionOperationId: input.deletionOperationId,
        stuckPurges: stuckPurges.map((stuck) => String(stuck.noteId)),
      },
    );
  }
}

const continuationPayload = (
  deletionOperationId: string,
  stuckPurges: readonly StuckPurge[],
): ScopeTaskPayload =>
  stuckPurges.length === 0
    ? { deletionOperationId }
    : {
        deletionOperationId,
        [STUCK_PURGES]: stuckPurges.map((stuck) => ({
          noteId: String(stuck.noteId),
          expectedVersion: stuck.expectedVersion,
        })),
      };

/**
 * Whether the failure left the note where no enumeration can find it.
 *
 * A route that still resolves means the purge refused and handed it
 * back, so the next turn meets the note the ordinary way and the id is
 * not worth carrying. A route that does not resolve is the opposite:
 * `purging` (this operation's stopped saga, or a rival's), `reserved`,
 * or an expired tombstone — none of which the listing will offer again
 * once the local delete has committed.
 */
const isOutOfReach = async (
  container: NotePurgeContainer,
  noteId: NoteId,
): Promise<boolean> => {
  try {
    return (await container.noteRouteStore.resolve(noteId)) === null;
  } catch {
    // The one place a broad catch earns its keep here: not knowing costs
    // one wasted retry if the note was fine, and a permanently
    // unreachable note if it was not.
    return true;
  }
};

async function settle(
  container: NotePurgeContainer,
  input: DeleteNotesForOwnerInput,
  outcome: TurnOutcome &
    Readonly<{
      targets: number;
      remaining: number;
      newlyStuck: boolean;
    }>,
): Promise<DeleteNotesForOwnerView> {
  const { purgedCount, stuckPurges } = outcome;
  const now = container.clock.now();
  const payload = continuationPayload(input.deletionOperationId, stuckPurges);

  return container.scopeUnitOfWorkProvider.run(input.scope, async (ctx) => {
    if (outcome.targets > 0 && purgedCount === 0 && !outcome.newlyStuck) {
      // Safe to lose this payload to an existing row: nothing is newly
      // stuck, so what would be written is a subset of what that row
      // already carries.
      await ctx.scopeTaskScheduler.backoffOrSchedule({
        kind: NOTE_OWNER_PURGE_TASK_KIND,
        operationId: input.deletionOperationId,
        priority: ScopeTaskPriority.securityCleanup,
        payload,
        now,
      });
      return {
        status: "stalled",
        personalCleanupCompleted: false,
        purgedCount,
      };
    }

    if (outcome.remaining > outcome.purgedFromPage || stuckPurges.length > 0) {
      await ctx.scopeTaskScheduler.schedule({
        kind: NOTE_OWNER_PURGE_TASK_KIND,
        operationId: input.deletionOperationId,
        priority: ScopeTaskPriority.securityCleanup,
        dueAt: now,
        payload,
      });
      return {
        status: "continued",
        personalCleanupCompleted: false,
        purgedCount,
      };
    }

    await ctx.cleanupAdmission.acknowledgePersonalComponent(
      input.deletionOperationId,
      "note",
    );
    await ctx.scopeTaskScheduler.complete(
      NOTE_OWNER_PURGE_TASK_KIND,
      input.deletionOperationId,
    );
    return {
      status: "settled",
      personalCleanupCompleted: await completePersonalCleanupIfDone(ctx, {
        operationId: input.deletionOperationId,
        now,
      }),
      purgedCount,
    };
  });
}

const ownerOfScope = (scope: ScopeKey): NoteOwner =>
  scope.type === "user"
    ? NoteOwner.user(scope.userId)
    : NoteOwner.workspace(scope.workspaceId);
