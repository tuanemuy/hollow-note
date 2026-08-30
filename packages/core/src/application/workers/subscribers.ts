import type { DomainEvent } from "@repo/core/domain/common/event";
import { scopeOfNoteOwner } from "../cleanup/notePurgeFanOut";
import type { WorkerContainer } from "../di/types";
import { authResidueCleanup } from "../identity/authResidueCleanup";
import type { IdentityContinuationEvent } from "../identity/continuations";
import { dispatchAccountDeletionRedaction } from "../identity/deleteAccount/authorRedaction";
import { dispatchAccountDeletionCleanup } from "../identity/deleteAccount/cleanupDispatch";
import { compactAccountDeletionManifest } from "../identity/deleteAccount/compaction";
import { finalizeAccountDeletion } from "../identity/deleteAccount/finalize";
import { runAccountDeletionGlobalCleanup } from "../identity/deleteAccount/globalCleanup";
import { continueAccountDeletionManifestBuild } from "../identity/deleteAccount/manifestBuild";
import { identityRemovalRelease } from "../identity/identityRemovalRelease";
import { deleteBackupRecordsForNote } from "../integration/deleteBackupRecordsForNote";
import { deleteFilesForNote } from "../storage/deleteFilesForNote";
import { deleteStoredObjects } from "../storage/deleteStoredObjects";
import { deleteAssignmentsForNote } from "../tag/deleteAssignmentsForNote";
import { projectMembershipRole } from "../workspace/membershipRoleProjection";
import type { AllDomainEvents } from "./eventRelayWorker";

type SubscriberFor<TType extends AllDomainEvents["type"]> = Readonly<{
  eventType: TType;
  /** Identifies the subscriber within the registry, unique per event
   * type. No subscriber currently routes through an `IdempotencyStore`;
   * each one states why its effect is replay-safe in its own usecase. */
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

type ContinuationSubscribers = {
  readonly [K in IdentityContinuationEvent["type"]]: readonly [
    SubscriberFor<K>,
    ...SubscriberFor<K>[],
  ];
};

/**
 * Subscribers of the continuation requests, keyed by continuation type.
 *
 * A continuation is not a notification: it carries the rest of a job no
 * turn could finish, so leaving one unsubscribed stops the chain instead
 * of merely ignoring an event — and the dispatcher below would only warn
 * about it. Keying by type with a non-empty tuple per key is what turns
 * a missing registration into a compile error.
 */
export const continuationSubscribers: ContinuationSubscribers = {
  "identity.userAuthResidueCleanupContinued": [
    {
      eventType: "identity.userAuthResidueCleanupContinued",
      consumerName: "identity.authResidueCleanup",
      handle: authResidueCleanup,
    },
  ],
  "identity.accountDeletionManifestBuildContinued": [
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
  ],
  // Every dispatch phase subscribes separately and passes on the phases
  // it does not own, so a phase is wired by adding an entry rather than
  // by editing a shared switch.
  "identity.accountDeletionDispatchContinued": [
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
  ],
  "identity.accountDeletionManifestCompactContinued": [
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
  ],
};

const domainEventSubscribers: readonly EventSubscriber[] = [
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
    eventType: "workspace.membership.roleChanged",
    consumerName: "workspace.membershipRoleProjection",
    handle: projectMembershipRole,
  },
  // The `note.purged` fan-out. Each follower owns one aggregate's rows
  // and settles its own continuation, so they are independent
  // subscribers rather than steps of one handler: a redelivery re-runs
  // every one of them, and each is a no-op once its own rows are gone.
  {
    eventType: "note.purged",
    consumerName: "storage.deleteFilesForNote",
    handle: async (event, deps) => {
      await deleteFilesForNote({
        container: deps,
        input: {
          noteId: event.payload.noteId,
          scope: scopeOfNoteOwner(event.payload.owner),
          operationId: event.payload.operationId,
          deletionOperationId: event.payload.deletionOperationId,
        },
      });
    },
  },
  {
    eventType: "note.purged",
    consumerName: "tag.deleteAssignmentsForNote",
    handle: async (event, deps) => {
      await deleteAssignmentsForNote({
        container: deps,
        input: {
          noteId: event.payload.noteId,
          scope: scopeOfNoteOwner(event.payload.owner),
          operationId: event.payload.operationId,
          deletionOperationId: event.payload.deletionOperationId,
        },
      });
    },
  },
  {
    eventType: "note.purged",
    consumerName: "integration.deleteBackupRecordsForNote",
    handle: async (event, deps) => {
      await deleteBackupRecordsForNote({
        container: deps,
        input: {
          noteId: event.payload.noteId,
          scope: scopeOfNoteOwner(event.payload.owner),
          operationId: event.payload.operationId,
          deletionOperationId: event.payload.deletionOperationId,
        },
      });
    },
  },
];

/**
 * The single entry point for events the relay delivered: the consumer
 * role of every runtime looks the event up here instead of holding its
 * own switch. Several subscribers may share an event type; they run in
 * registration order and a throw fails the whole delivery, so every
 * handler must be safe to re-run (delivery is at-least-once).
 */
export const subscribers: readonly EventSubscriber[] = [
  ...domainEventSubscribers,
  ...Object.values(continuationSubscribers).flat(),
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
