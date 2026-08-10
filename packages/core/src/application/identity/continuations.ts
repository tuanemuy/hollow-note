import type {
  DomainEventBase,
  EventDraft,
} from "@repo/core/domain/common/event";
import type { UserId } from "@repo/core/domain/identity/valueObject";

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

export type IdentityContinuationEvent = UserAuthResidueCleanupContinuedEvent;

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
};
