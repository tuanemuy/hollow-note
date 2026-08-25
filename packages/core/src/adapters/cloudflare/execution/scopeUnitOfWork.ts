import { mintEventIdFor } from "../../../application/execution/eventId";
import type {
  ScopeUnitOfWorkContext,
  ScopeUnitOfWorkProvider,
} from "../../../application/execution/unitOfWork";
import type { RelayTrigger } from "../../../application/ports/relayTrigger";
import type { ScopeTaskTrigger } from "../../../application/ports/scopeTaskTrigger";
import type { ScopeKey } from "../../../application/scope";
import type { EventDraft, EventId } from "../../../domain/common/event";
import { attachEventIds, type DomainEvent } from "../../../domain/common/event";
import { SCHEDULED_TASKS_TABLE } from "../do/schema";
import { throwTranslated } from "../sql/errors";
import type { ScopeSqlExecutor } from "../sql/executor";
import { createStagedSession, type SqlSession } from "../sql/session";
import { runInUnitOfWork } from "./nesting";
import { WriteSet } from "./writeSet";

/** The context minus the one member the unit of work itself supplies. */
export type ScopePlaneRepositories = Omit<
  ScopeUnitOfWorkContext,
  "collectEvents"
>;

export type ScopeUnitOfWorkOptions = Readonly<{
  /** Resolves the storage of one scope object. */
  openScope: (scope: ScopeKey) => ScopeSqlExecutor;
  mintEventId: () => EventId;
  buildRepositories: (
    session: SqlSession,
    scope: ScopeKey,
  ) => ScopePlaneRepositories;
  stageOutbox: (
    session: SqlSession,
    events: readonly DomainEvent[],
  ) => Promise<void>;
  relayTrigger?: RelayTrigger;
  scopeTaskTrigger?: ScopeTaskTrigger;
}>;

/**
 * Scope-plane unit of work over a scope Durable Object.
 *
 * The callback runs in the **caller's** isolate, not inside the object:
 * `run(scope, fn)` takes an arbitrary closure, which cannot be shipped
 * over RPC, so reads are RPC round trips and writes are staged locally.
 * Commit hands the whole write-set to the object in one call, where it
 * applies under
 * `ctx.storage.transactionSync` — the object never awaits anything
 * inside that transaction, per `spec/platform/index.md`「外部要求」.
 *
 * A unit that staged nothing skips the commit call: with no statements
 * and no touched tables the object would have nothing to do, and the
 * round trip is the expensive part of this plane.
 *
 * Two triggers fire after a successful commit and only then: the relay
 * when the unit flushed events, and the scope-task trigger when it wrote
 * `scheduled_tasks`. Reading the second from the write-set's touched
 * tables — rather than by wrapping `schedule` — means every path that
 * arms a continuation kicks, including a `backoff` that re-arms one.
 */
export function createScopeUnitOfWorkProvider(
  options: ScopeUnitOfWorkOptions,
): ScopeUnitOfWorkProvider {
  return {
    run<T>(
      scope: ScopeKey,
      fn: (ctx: ScopeUnitOfWorkContext) => Promise<T>,
    ): Promise<T> {
      return runInUnitOfWork("scope", async () => {
        const executor = options.openScope(scope);
        const writeSet = new WriteSet();
        const session = createStagedSession(executor, writeSet);
        const buffered: DomainEvent[] = [];
        const ctx: ScopeUnitOfWorkContext = {
          ...options.buildRepositories(session, scope),
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
        const touched = writeSet.touchedTables();
        if (!writeSet.isEmpty()) {
          try {
            await executor.applyWriteSet(writeSet.statements(), touched);
          } catch (cause) {
            throwTranslated("the scope unit of work", cause);
          }
        }
        if (buffered.length > 0) {
          options.relayTrigger?.kick();
        }
        if (touched.includes(SCHEDULED_TASKS_TABLE)) {
          options.scopeTaskTrigger?.kick();
        }
        return value;
      });
    },
  };
}
