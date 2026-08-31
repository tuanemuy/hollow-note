import type { Note } from "@repo/core/domain/note/note";
import { NoteOwner } from "@repo/core/domain/note/valueObject";
import { NOTE_OWNER_PURGE_TASK_KIND } from "../cleanup/participants";
import {
  completePersonalCleanupIfDone,
  type ScopeCleanupTurn,
} from "../cleanup/personalCleanup";
import type { NotePurgeContainer } from "../di/types";
import { ScopeTaskPriority } from "../ports/scopeTaskScheduler";
import type { ScopeKey } from "../scope";
import { purgeNoteInternally } from "./purgeNote";

export { NOTE_OWNER_PURGE_TASK_KIND };

/**
 * Notes one turn purges. The cap is about the CPU of a single alarm turn
 * and the `note.purged` fan-out it emits, not about query count —
 * scope-local SQL carries no D1 budget (spec/platform/index.md「実行予算
 * と分割単位」).
 */
export const OWNER_PURGE_BATCH_SIZE = 100;

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
}>;

export type DeleteNotesForOwnerView = ScopeCleanupTurn &
  Readonly<{ purgedCount: number }>;

export type DeleteNotesForOwnerArgs = Readonly<{
  container: NotePurgeContainer;
  input: DeleteNotesForOwnerInput;
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
 * "Targets remain but none could be purged" is the one outcome that must
 * not breed a continuation — it would spin on a permanently failing
 * note. The turn backs its own row off instead and leaves the retry to
 * the schedule. Zero targets is the opposite: the work is finished, so
 * the component is acknowledged and the row completed.
 *
 * **Divergence from the spec's step 4**: the continuation cannot share
 * the transaction of the batch's last delete, because in this deployment
 * a purge is a saga over three stores that owns its own transaction
 * (ADR 017) and nesting `run` is forbidden. It is armed in a
 * transaction of its own, immediately after the batch. A response lost
 * between the two leaves the purged notes purged and the row unarmed —
 * recovered by the same command being redelivered, which is the normal
 * case for a cleanup command.
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
  const page = await container.scopeUnitOfWorkProvider.run(
    input.scope,
    async (ctx) => {
      await ctx.cleanupAdmission.assertOwner(input.deletionOperationId);
      return ctx.noteRepository.listByOwner(owner, "all", {
        page: 1,
        limit: batchSize,
      });
    },
  );
  const purgedCount = await purgeEachNote(container, input, page.items);

  return settle(container, input, {
    targets: page.items.length,
    remaining: page.count,
    purgedCount,
  });
}

/**
 * One note's failure is recorded and left behind: the notes of a scope
 * are unrelated, and stopping would strand the rest of the scope on a
 * single stuck route. The redelivery or the next continuation reads it
 * again from the start.
 */
async function purgeEachNote(
  container: NotePurgeContainer,
  input: DeleteNotesForOwnerInput,
  notes: readonly Note[],
): Promise<number> {
  let purgedCount = 0;
  for (const note of notes) {
    try {
      await purgeNoteInternally({
        container,
        input: {
          kind: "scopeCleanup",
          noteId: note.id,
          expectedVersion: note.version,
          scope: input.scope,
          deletionOperationId: input.deletionOperationId,
        },
      });
      purgedCount += 1;
    } catch (cause) {
      container.logger.error("[deleteNotesForOwner] a note was left behind", {
        cause,
        noteId: note.id,
        deletionOperationId: input.deletionOperationId,
      });
    }
  }
  return purgedCount;
}

async function settle(
  container: NotePurgeContainer,
  input: DeleteNotesForOwnerInput,
  outcome: Readonly<{
    targets: number;
    remaining: number;
    purgedCount: number;
  }>,
): Promise<DeleteNotesForOwnerView> {
  const { purgedCount } = outcome;
  const now = container.clock.now();

  return container.scopeUnitOfWorkProvider.run(input.scope, async (ctx) => {
    if (outcome.targets > 0 && purgedCount === 0) {
      await ctx.scopeTaskScheduler.backoffOrSchedule({
        kind: NOTE_OWNER_PURGE_TASK_KIND,
        operationId: input.deletionOperationId,
        priority: ScopeTaskPriority.securityCleanup,
        payload: { deletionOperationId: input.deletionOperationId },
        now,
      });
      return {
        status: "stalled",
        personalCleanupCompleted: false,
        purgedCount,
      };
    }

    if (outcome.remaining > purgedCount) {
      await ctx.scopeTaskScheduler.schedule({
        kind: NOTE_OWNER_PURGE_TASK_KIND,
        operationId: input.deletionOperationId,
        priority: ScopeTaskPriority.securityCleanup,
        dueAt: now,
        payload: { deletionOperationId: input.deletionOperationId },
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
