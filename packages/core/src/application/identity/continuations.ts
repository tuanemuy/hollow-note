import type {
  DomainEventBase,
  EventDraft,
} from "@repo/core/domain/common/event";
import type { UserId } from "@repo/core/domain/identity/valueObject";
import type {
  AccountDeletionBuildPhase,
  AccountDeletionDispatchPhase,
} from "./deleteAccount/input";

export type AuthResidueTable = "sessions" | "authTokens";

/**
 * Continuation request — not a domain event: it carries the rest of a
 * job that one turn could not finish, and it has exactly one subscriber
 * (spec/domains/index.md#継続要求). It rides the global outbox because
 * the rows it reclaims live on the global plane.
 *
 * No cursor: the work itself (deleting the rows) removes them from the
 * set the next turn reads, so "read the first `limit` rows that are
 * still there" always moves forward.
 */
export type UserAuthResidueCleanupContinuedEvent = DomainEventBase<
  "identity.userAuthResidueCleanupContinued",
  Readonly<{
    userId: UserId;
    authEpoch: number;
    table: AuthResidueTable;
    /** Set when the epoch bump came from account deletion — the terminal
     * turn acknowledges the `authResidue` receipt for it. */
    deletionOperationId: string | null;
  }>
>;

/**
 * Continuation of the account-deletion manifest build: one turn fixes
 * one page of targets, starting at `cursor`.
 *
 * `continuationKey` is what makes the event id deterministic (ADR-019):
 * a turn whose commit response was lost re-derives the same key, so the
 * replay upserts the same outbox row instead of forking the chain.
 */
export type AccountDeletionManifestBuildContinuedEvent = DomainEventBase<
  "identity.accountDeletionManifestBuildContinued",
  Readonly<{
    operationId: string;
    phase: AccountDeletionBuildPhase;
    cursor: string | null;
    continuationKey: string;
  }>
>;

/** Continuation of one account-deletion dispatch phase (same key rules). */
export type AccountDeletionDispatchContinuedEvent = DomainEventBase<
  "identity.accountDeletionDispatchContinued",
  Readonly<{
    operationId: string;
    phase: AccountDeletionDispatchPhase;
    continuationKey: string;
  }>
>;

export type IdentityContinuationEvent =
  | UserAuthResidueCleanupContinuedEvent
  | AccountDeletionManifestBuildContinuedEvent
  | AccountDeletionDispatchContinuedEvent;

const continuationKey = (
  eventType: string,
  operationId: string,
  phase: string,
  cursor: string | null,
): string => `${eventType}:${operationId}:${phase}:${cursor ?? "-"}`;

export const IdentityContinuations = {
  userAuthResidueCleanup: (
    params: Readonly<{
      userId: UserId;
      authEpoch: number;
      table: AuthResidueTable;
      deletionOperationId: string | null;
    }>,
    occurredAt: Date,
  ): EventDraft<UserAuthResidueCleanupContinuedEvent> => ({
    type: "identity.userAuthResidueCleanupContinued",
    payload: params,
    occurredAt,
    aggregateId: params.userId,
  }),

  accountDeletionManifestBuild: (
    params: Readonly<{
      operationId: string;
      phase: AccountDeletionBuildPhase;
      /** Page position the next turn starts from. */
      cursor: string | null;
    }>,
    occurredAt: Date,
  ): EventDraft<AccountDeletionManifestBuildContinuedEvent> => {
    const type = "identity.accountDeletionManifestBuildContinued";
    return {
      type,
      payload: {
        operationId: params.operationId,
        phase: params.phase,
        cursor: params.cursor,
        continuationKey: continuationKey(
          type,
          params.operationId,
          params.phase,
          params.cursor,
        ),
      },
      occurredAt,
      aggregateId: params.operationId,
    };
  },

  accountDeletionDispatch: (
    params: Readonly<{
      operationId: string;
      phase: AccountDeletionDispatchPhase;
      cursor?: string | null;
    }>,
    occurredAt: Date,
  ): EventDraft<AccountDeletionDispatchContinuedEvent> => {
    const type = "identity.accountDeletionDispatchContinued";
    return {
      type,
      payload: {
        operationId: params.operationId,
        phase: params.phase,
        continuationKey: continuationKey(
          type,
          params.operationId,
          params.phase,
          params.cursor ?? null,
        ),
      },
      occurredAt,
      aggregateId: params.operationId,
    };
  },
};
