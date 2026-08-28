import { mintEventIdFor } from "../../../application/execution/eventId";
import type {
  GlobalUnitOfWorkContext,
  GlobalUnitOfWorkProvider,
} from "../../../application/execution/unitOfWork";
import type { RelayTrigger } from "../../../application/ports/relayTrigger";
import type { EventDraft, EventId } from "../../../domain/common/event";
import { attachEventIds, type DomainEvent } from "../../../domain/common/event";
import { throwTranslated } from "../sql/errors";
import type { SqlExecutor } from "../sql/executor";
import { createStagedSession, type SqlSession } from "../sql/session";
import { runInUnitOfWork } from "./nesting";
import { WriteSet } from "./writeSet";

/** The context minus the one member the unit of work itself supplies. */
export type GlobalPlaneRepositories = Omit<
  GlobalUnitOfWorkContext,
  "collectEvents"
>;

export type GlobalUnitOfWorkOptions = Readonly<{
  /** Global D1. */
  executor: SqlExecutor;
  mintEventId: () => EventId;
  /** Builds the plane's repositories over the unit's staged session. */
  buildRepositories: (session: SqlSession) => GlobalPlaneRepositories;
  /** Stages the transactional outbox insert for the flushed events. */
  stageOutbox: (
    session: SqlSession,
    events: readonly DomainEvent[],
  ) => Promise<void>;
  relayTrigger?: RelayTrigger;
}>;

/**
 * Global-plane unit of work over D1.
 *
 * The callback runs against a staged session: reads go to D1 and are
 * overlaid with what this unit has already written, writes accumulate in
 * a `WriteSet`. Committing applies the whole set as one `batch()`, which
 * is the only atomic unit D1 offers — a callback that throws simply
 * drops the buffer, so nothing it wrote and no event it buffered is ever
 * visible.
 *
 * Event drafts buffered through `collectEvents` get their `EventId`
 * minted as they arrive and are staged into the same write-set as the
 * entity writes, which is what makes the outbox flush transactional. The
 * relay is kicked once, after a commit that carried events — never
 * before, and never for a rolled-back unit. The kick happens after the
 * unit's async context has closed, so a trigger that opens a unit of
 * work of its own does not trip the nesting bar.
 *
 * One commit is one batch and one batch is `n` D1 queries, so the size
 * of a write-set is spent directly out of the invocation's query budget.
 * `createD1Executor.apply` refuses a batch that outgrew
 * `MAX_STATEMENTS_PER_COMMIT`, which is why the check does not appear
 * here.
 *
 * Optimistic-lock conflicts are enforced inside the batch by the
 * `_occ_guard` trip wire (`../sql/occGuard.ts`), because a conditional
 * `UPDATE` that matches nothing is not an error to SQLite. A tripped
 * guard aborts the batch and surfaces as
 * `ConflictError("OPTIMISTIC_LOCK_FAILURE")`.
 */
export function createGlobalUnitOfWorkProvider(
  options: GlobalUnitOfWorkOptions,
): GlobalUnitOfWorkProvider {
  return {
    async run<T>(fn: (ctx: GlobalUnitOfWorkContext) => Promise<T>): Promise<T> {
      const committed = await runInUnitOfWork("global", async () => {
        const writeSet = new WriteSet();
        const session = createStagedSession(options.executor, writeSet);
        const buffered: DomainEvent[] = [];
        const ctx: GlobalUnitOfWorkContext = {
          ...options.buildRepositories(session),
          collectEvents(drafts: readonly EventDraft[]): void {
            buffered.push(
              ...attachEventIds(drafts, (draft) =>
                mintEventIdFor(draft, options.mintEventId),
              ),
            );
          },
        };
        const value = await fn(ctx);
        if (buffered.length > 0) {
          await options.stageOutbox(session, buffered);
        }
        try {
          await options.executor.apply(writeSet.statements());
        } catch (cause) {
          throwTranslated("the global unit of work", cause);
        }
        return { value, flushedEvents: buffered.length > 0 };
      });
      if (committed.flushedEvents) {
        options.relayTrigger?.kick();
      }
      return committed.value;
    },
  };
}
