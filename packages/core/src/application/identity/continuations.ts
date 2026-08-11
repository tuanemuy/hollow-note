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
 * replay is skipped in favour of the first-writer row and collapses into
 * that single outbox row instead of forking the chain (ADR-065).
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

/**
 * Continuation of one account-deletion dispatch phase.
 *
 * `cursor` discriminates the turns of a phase that needs several of them.
 * A deterministic id may only be given to a continuation whose key
 * changes per turn (ADR-025): a turn re-emitting its own key would be
 * marked processed by the very relay finalize that follows it, and the
 * chain would stop. The redaction pages therefore number their turns
 * here, and the several producers of a `finalize` attempt name
 * themselves, so their attempts stay separate events.
 */
export type AccountDeletionDispatchContinuedEvent = DomainEventBase<
  "identity.accountDeletionDispatchContinued",
  Readonly<{
    operationId: string;
    phase: AccountDeletionDispatchPhase;
    cursor: string | null;
    continuationKey: string;
  }>
>;

/** Continuation of the manifest compaction; `cursor` numbers the turns. */
export type AccountDeletionManifestCompactContinuedEvent = DomainEventBase<
  "identity.accountDeletionManifestCompactContinued",
  Readonly<{
    operationId: string;
    cursor: string | null;
    continuationKey: string;
  }>
>;

export type IdentityContinuationEvent =
  | UserAuthResidueCleanupContinuedEvent
  | AccountDeletionManifestBuildContinuedEvent
  | AccountDeletionDispatchContinuedEvent
  | AccountDeletionManifestCompactContinuedEvent;

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
    const cursor = params.cursor ?? null;
    return {
      type,
      payload: {
        operationId: params.operationId,
        phase: params.phase,
        cursor,
        continuationKey: continuationKey(
          type,
          params.operationId,
          params.phase,
          cursor,
        ),
      },
      occurredAt,
      aggregateId: params.operationId,
    };
  },

  accountDeletionManifestCompact: (
    params: Readonly<{ operationId: string; cursor: string | null }>,
    occurredAt: Date,
  ): EventDraft<AccountDeletionManifestCompactContinuedEvent> => {
    const type = "identity.accountDeletionManifestCompactContinued";
    return {
      type,
      payload: {
        operationId: params.operationId,
        cursor: params.cursor,
        continuationKey: continuationKey(
          type,
          params.operationId,
          "compact",
          params.cursor,
        ),
      },
      occurredAt,
      aggregateId: params.operationId,
    };
  },
};
