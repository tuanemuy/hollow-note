import {
  type ConsumerHandler,
  createInMemoryQueueDispatcher,
} from "@repo/core/adapters/node/inMemoryQueueDispatcher";
import {
  createInProcessRelayTrigger,
  type InProcessRelayTrigger,
} from "@repo/core/adapters/node/inProcessRelayTrigger";
import type { WorkerContainer } from "@repo/core/application/di/types";
import { pruneAccountDeletionManifests } from "@repo/core/application/identity/deleteAccount/terminalPrune";
import type { Logger } from "@repo/core/application/ports/logger";
import type { RelayTrigger } from "@repo/core/application/ports/relayTrigger";
import type { ScopeTaskTrigger } from "@repo/core/application/ports/scopeTaskTrigger";
import {
  type EventDispatcher,
  type ProcessOutboxEventsOptions,
  processOutboxEvents,
} from "@repo/core/application/workers/eventRelayWorker";
import {
  DEFAULT_OUTBOX_RETENTION_MS,
  pruneOutbox,
} from "@repo/core/application/workers/outboxPrune";
import { runDueScopeTasks } from "@repo/core/application/workers/scopeTaskRunner";
import type { DomainEvent } from "@repo/core/domain/common/event";

export type NodeWorkerRunnerTuning = Readonly<{
  relayIntervalMs?: number;
  pruneIntervalMs?: number;
  /**
   * Safety net behind the commit kick for scope-plane continuations
   * (ADR-023). A second, not the relay's minute: a deletion advances one
   * turn per round, so the interval is the worst-case wait per turn when
   * a kick is lost.
   */
  scopeTaskIntervalMs?: number;
  outboxRetentionMs?: number;
  relayOptions?: ProcessOutboxEventsOptions;
  consumerConcurrency?: number;
}>;

export type NodeWorkerRunnerDeps = Readonly<{
  container: WorkerContainer;
  logger: Logger;
  consumerHandler: ConsumerHandler;
  cleanup?: () => Promise<void>;
  tuning?: NodeWorkerRunnerTuning;
}>;

export type NodeWorkerRunner = Readonly<{
  start(): void;
  stop(): Promise<void>;
  relayTrigger: RelayTrigger;
  scopeTaskTrigger: ScopeTaskTrigger;
}>;

const DEFAULT_RELAY_INTERVAL_MS = 60_000;
const DEFAULT_PRUNE_INTERVAL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_SCOPE_TASK_INTERVAL_MS = 1_000;
const RECEIPT_SWEEP_PAGE_LIMIT = 100;
const RECEIPT_SWEEP_MAX_PAGES = 100;

/**
 * Single-process orchestrator for the four background roles of the Node
 * runtime (relay, consumer, pruner, dlq). `start()` registers timers +
 * signal handlers,
 * `relayTrigger.kick()` schedules an out-of-band relay tick collapsed
 * with concurrent kicks, `stop()` drains in-flight work and runs
 * `cleanup`. All three are idempotent.
 *
 * The "DLQ" role is satisfied by `processOutboxEvents`'s existing
 * `[outbox] quarantining event …` log line when `failed_at` is stamped;
 * a dedicated table / sweep is intentionally out of scope.
 */
export function createNodeWorkerRunner(
  deps: NodeWorkerRunnerDeps,
): NodeWorkerRunner {
  const { container, logger, consumerHandler: handler } = deps;
  const tuning = deps.tuning ?? {};

  const relayIntervalMs = tuning.relayIntervalMs ?? DEFAULT_RELAY_INTERVAL_MS;
  const pruneIntervalMs = tuning.pruneIntervalMs ?? DEFAULT_PRUNE_INTERVAL_MS;
  const scopeTaskIntervalMs =
    tuning.scopeTaskIntervalMs ?? DEFAULT_SCOPE_TASK_INTERVAL_MS;
  const outboxRetentionMs =
    tuning.outboxRetentionMs ?? DEFAULT_OUTBOX_RETENTION_MS;

  const consumerDispatch: EventDispatcher = createInMemoryQueueDispatcher({
    handler: async (event: DomainEvent) => {
      // No duplicate suppression here: `IdempotencyStore` is reserved
      // for non-commutative subscribers, and its record must share a
      // unit of work with the subscriber's main effect
      // (application/ports/idempotencyStore.ts). A real consumer owns
      // that pairing inside its own usecase — a standalone
      // `markProcessed` in this dispatch loop would commit the record
      // without any effect and violate the contract.
      container.logger.info(`[queue] received ${event.type} ${event.id}`, {
        event,
      });
      await handler(event);
    },
    ...(tuning.consumerConcurrency !== undefined
      ? { concurrency: tuning.consumerConcurrency }
      : {}),
  });

  const runRelayTick = async (): Promise<void> => {
    try {
      await processOutboxEvents(
        container,
        consumerDispatch,
        tuning.relayOptions ?? {},
      );
    } catch (cause) {
      logger.error("[runner.node] relay tick threw", { cause });
    }
  };

  const relayTrigger: InProcessRelayTrigger = createInProcessRelayTrigger({
    runTick: runRelayTick,
    logger,
  });

  const runScopeTaskTick = async (): Promise<void> => {
    try {
      await runDueScopeTasks(container);
    } catch (cause) {
      logger.error("[runner.node] scope task tick threw", { cause });
    }
  };

  // Same serialization discipline as the relay: at most one round in
  // flight, concurrent kicks collapsed into a single re-run.
  const scopeTaskTrigger: InProcessRelayTrigger = createInProcessRelayTrigger({
    runTick: runScopeTaskTick,
    logger,
  });

  /**
   * Reclaims the removal receipts whose 30 days are up. The store is a
   * plain keyset sweep rather than a maintenance-run lane, so the bound
   * lives here: a page cap keeps one tick from monopolizing the process,
   * and the next tick resumes from the start since the sweep only ever
   * removes expired rows.
   */
  const sweepIdentityRemovalReceipts = async (): Promise<void> => {
    let cursor: string | null = null;
    for (let page = 0; page < RECEIPT_SWEEP_MAX_PAGES; page += 1) {
      const swept = await container.identityRemovalReceiptStore.deleteExpired(
        container.clock.now(),
        cursor,
        RECEIPT_SWEEP_PAGE_LIMIT,
      );
      if (swept.nextCursor === null) return;
      cursor = swept.nextCursor;
    }
  };

  // The three sweeps are isolated from one another: they reclaim
  // unrelated tables, and the deletion ones carry personal data whose
  // retention must not hinge on the outbox prune succeeding.
  const runPruneTick = async (): Promise<void> => {
    try {
      await pruneOutbox(container, { retentionMs: outboxRetentionMs });
    } catch (cause) {
      logger.error("[runner.node] prune tick threw", { cause });
    }
    try {
      await pruneAccountDeletionManifests({
        container,
        input: { type: "cron" },
      });
    } catch (cause) {
      logger.error("[runner.node] manifest prune threw", { cause });
    }
    try {
      await sweepIdentityRemovalReceipts();
    } catch (cause) {
      logger.error("[runner.node] removal receipt sweep threw", { cause });
    }
  };

  let started = false;
  let stopping: Promise<void> | null = null;

  let relayTimer: ReturnType<typeof setInterval> | null = null;
  let pruneTimer: ReturnType<typeof setInterval> | null = null;
  let scopeTaskTimer: ReturnType<typeof setInterval> | null = null;

  // Tracked so `stop()` awaits every outstanding promise scheduled
  // outside the trigger.
  const pendingSweeps = new Set<Promise<void>>();
  const track = (promise: Promise<void>): void => {
    pendingSweeps.add(promise);
    promise.finally(() => {
      pendingSweeps.delete(promise);
    });
  };

  const signalHandler = (signal: NodeJS.Signals): void => {
    logger.info(`[runner.node] received ${signal}, shutting down`);
    void stop();
  };
  // Captured references so `process.off` can deregister the exact
  // listener we registered across start/stop cycles.
  const onSigterm = () => signalHandler("SIGTERM");
  const onSigint = () => signalHandler("SIGINT");

  const start = (): void => {
    if (started) return;
    started = true;

    // Drain crash-leftover backlog without waiting a full interval —
    // including the scope-plane continuations a previous process left
    // due, which live in the task table rather than in its memory. The
    // drain goes through the trigger so it collapses with a commit kick
    // arriving in the same moment instead of racing it.
    track(runRelayTick());
    scopeTaskTrigger.kick();

    relayTimer = setInterval(() => {
      track(runRelayTick());
    }, relayIntervalMs);
    pruneTimer = setInterval(() => {
      track(runPruneTick());
    }, pruneIntervalMs);
    scopeTaskTimer = setInterval(() => {
      scopeTaskTrigger.kick();
    }, scopeTaskIntervalMs);

    // Let the event loop exit naturally in tests / scripts; production
    // holds the loop open via the HTTP server.
    relayTimer.unref?.();
    pruneTimer.unref?.();
    scopeTaskTimer.unref?.();

    process.on("SIGTERM", onSigterm);
    process.on("SIGINT", onSigint);
  };

  const stop = async (): Promise<void> => {
    if (stopping !== null) return stopping;
    stopping = (async () => {
      if (relayTimer !== null) {
        clearInterval(relayTimer);
        relayTimer = null;
      }
      if (pruneTimer !== null) {
        clearInterval(pruneTimer);
        pruneTimer = null;
      }
      if (scopeTaskTimer !== null) {
        clearInterval(scopeTaskTimer);
        scopeTaskTimer = null;
      }
      process.off("SIGTERM", onSigterm);
      process.off("SIGINT", onSigint);

      await relayTrigger.stop();
      await scopeTaskTrigger.stop();
      // Snapshot via `Array.from` so concurrently-finishing entries that
      // mutate the Set don't disturb iteration.
      await Promise.all(Array.from(pendingSweeps));

      if (deps.cleanup !== undefined) {
        try {
          await deps.cleanup();
        } catch (cause) {
          logger.error("[runner.node] cleanup threw", { cause });
        }
      }
    })();
    return stopping;
  };

  return {
    start,
    stop,
    relayTrigger,
    scopeTaskTrigger,
  };
}
