import type { DomainEvent } from "@repo/core/domain/common/event";
import type { WorkerContainer } from "../di/types";
import { authResidueCleanup } from "../identity/authResidueCleanup";
import { dispatchAccountDeletionRedaction } from "../identity/deleteAccount/authorRedaction";
import { dispatchAccountDeletionCleanup } from "../identity/deleteAccount/cleanupDispatch";
import { compactAccountDeletionManifest } from "../identity/deleteAccount/compaction";
import { finalizeAccountDeletion } from "../identity/deleteAccount/finalize";
import { runAccountDeletionGlobalCleanup } from "../identity/deleteAccount/globalCleanup";
import { continueAccountDeletionManifestBuild } from "../identity/deleteAccount/manifestBuild";
import { identityRemovalRelease } from "../identity/identityRemovalRelease";
import { deleteStoredObjects } from "../storage/deleteStoredObjects";
import type { AllDomainEvents } from "./eventRelayWorker";

type SubscriberFor<TType extends AllDomainEvents["type"]> = Readonly<{
  eventType: TType;
  /** Stable name used as the `IdempotencyStore` consumer key by the
   * subscribers that need one. */
  consumerName: string;
  handle: (
    event: Extract<AllDomainEvents, { type: TType }>,
    deps: WorkerContainer,
  ) => Promise<void>;
}>;

/**
 * One subscriber entry, discriminated by `eventType` so the handler is
 * typed against exactly the event it subscribes to.
 */
export type EventSubscriber = {
  [K in AllDomainEvents["type"]]: SubscriberFor<K>;
}[AllDomainEvents["type"]];

/**
 * The single entry point for events the relay delivered: the consumer
 * role of every runtime looks the event up here instead of holding its
 * own switch. Several subscribers may share an event type; they run in
 * registration order and a throw fails the whole delivery, so every
 * handler must be safe to re-run (delivery is at-least-once).
 */
export const subscribers: readonly EventSubscriber[] = [
  {
    eventType: "identity.userAuthResidueCleanupContinued",
    consumerName: "identity.authResidueCleanup",
    handle: authResidueCleanup,
  },
  {
    eventType: "identity.identity.removed",
    consumerName: "identity.identityRemovalRelease",
    handle: identityRemovalRelease,
  },
  {
    eventType: "storage.fileDeleted",
    consumerName: "storage.deleteStoredObjects",
    handle: deleteStoredObjects,
  },
  {
    eventType: "identity.accountDeletionManifestBuildContinued",
    consumerName: "identity.accountDeletionManifestBuild",
    handle: (event, deps) =>
      continueAccountDeletionManifestBuild(deps, {
        type: event.type,
        operationId: event.payload.operationId,
        phase: event.payload.phase,
        cursor: event.payload.cursor,
      }),
  },
  // Every dispatch phase subscribes separately and passes on the phases
  // it does not own, so a phase is wired by adding an entry rather than
  // by editing a shared switch.
  {
    eventType: "identity.accountDeletionDispatchContinued",
    consumerName: "identity.accountDeletionCleanup",
    handle: async (event, deps) => {
      if (event.payload.phase !== "cleanup") {
        return;
      }
      await dispatchAccountDeletionCleanup(deps, {
        type: event.type,
        operationId: event.payload.operationId,
        phase: "cleanup",
        cursor: event.payload.cursor,
      });
    },
  },
  {
    eventType: "identity.accountDeletionDispatchContinued",
    consumerName: "identity.accountDeletionGlobalCleanup",
    handle: async (event, deps) => {
      if (event.payload.phase !== "cleanup") {
        return;
      }
      await runAccountDeletionGlobalCleanup(deps, {
        type: event.type,
        operationId: event.payload.operationId,
        phase: "cleanup",
        cursor: event.payload.cursor,
      });
    },
  },
  {
    eventType: "identity.accountDeletionDispatchContinued",
    consumerName: "identity.accountDeletionRedaction",
    handle: async (event, deps) => {
      if (event.payload.phase !== "redaction") {
        return;
      }
      await dispatchAccountDeletionRedaction(deps, {
        type: event.type,
        operationId: event.payload.operationId,
        phase: "redaction",
        cursor: event.payload.cursor,
      });
    },
  },
  {
    eventType: "identity.accountDeletionDispatchContinued",
    consumerName: "identity.accountDeletionFinalize",
    handle: async (event, deps) => {
      if (event.payload.phase !== "finalize") {
        return;
      }
      await finalizeAccountDeletion(deps, {
        type: event.type,
        operationId: event.payload.operationId,
        phase: "finalize",
        cursor: event.payload.cursor,
      });
    },
  },
  {
    eventType: "identity.accountDeletionManifestCompactContinued",
    consumerName: "identity.accountDeletionManifestCompact",
    handle: (event, deps) =>
      compactAccountDeletionManifest(deps, {
        type: event.type,
        operationId: event.payload.operationId,
        cursor: event.payload.cursor,
      }),
  },
];

/**
 * Runs every subscriber registered for `event`. An event with no
 * subscriber is acknowledged with a warning — adding an event type must
 * never stall the relay.
 */
export async function dispatchDomainEvent(
  event: DomainEvent,
  deps: WorkerContainer,
  registry: readonly EventSubscriber[] = subscribers,
): Promise<void> {
  const matched = registry.filter(
    (subscriber) => subscriber.eventType === event.type,
  );
  if (matched.length === 0) {
    deps.logger.warn(`[subscribers] no subscriber for ${event.type}`, {
      eventId: event.id,
      eventType: event.type,
    });
    return;
  }
  for (const subscriber of matched) {
    // The `eventType` match above is what pairs a handler with its own
    // event shape; TS cannot follow that narrowing across two separately
    // typed values. Widening the handler is the single cast of the
    // dispatch, and it is confined to this line.
    const handle = subscriber.handle as (
      event: DomainEvent,
      deps: WorkerContainer,
    ) => Promise<void>;
    await handle(event, deps);
  }
}
