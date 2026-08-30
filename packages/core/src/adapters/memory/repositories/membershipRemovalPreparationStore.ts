import { ConflictError } from "../../../application/errors";
import type { UserId } from "../../../domain/identity/valueObject";
import type { MembershipRemovalPreparationStore } from "../../../domain/workspace/ports/membershipRemovalPreparationStore";
import type { MembershipRemovalLockRow, ScopeStore } from "../store";

const lockConflict = (detail: string): ConflictError =>
  new ConflictError("MEMBERSHIP_REMOVAL_LOCK_CONFLICT", detail);

const versionMismatch = (userId: UserId): ConflictError =>
  new ConflictError(
    "OPTIMISTIC_LOCK_FAILURE",
    `Membership of ${userId} is not at the observed version`,
  );

/** The later of the two instants — a lease never moves backwards. */
const laterOf = (stored: Date | null, next: Date): Date =>
  stored !== null && stored.getTime() > next.getTime() ? stored : next;

export function createMemoryMembershipRemovalPreparationStore(
  scope: ScopeStore,
): MembershipRemovalPreparationStore {
  const table = scope.membershipRemovalLocks;

  const requireLock = (operationId: string): MembershipRemovalLockRow => {
    const row = table.get(operationId);
    if (row === undefined) {
      throw lockConflict(`No removal lock for operation ${operationId}`);
    }
    return row;
  };

  return {
    async prepare(input): Promise<void> {
      const own = table.get(input.operationId);
      if (own !== undefined) {
        if (own.userId !== input.userId) {
          throw lockConflict(
            `Operation ${input.operationId} already locks another membership`,
          );
        }
        if (own.state === "prepared") {
          table.set(input.operationId, {
            ...own,
            expiresAt: laterOf(own.expiresAt, input.expiresAt),
          });
        }
        return;
      }
      // Expiry is deliberately not consulted: a lapsed lease still holds
      // the membership, and only global recovery decides its fate.
      const foreign = table.values().some((row) => row.userId === input.userId);
      if (foreign) {
        throw lockConflict(
          `Membership of ${input.userId} is locked by another operation`,
        );
      }
      const membership = scope.memberships
        .values()
        .find((row) => row.userId === input.userId);
      if (
        membership === undefined ||
        (membership.version as number) !== input.expectedMembershipVersion
      ) {
        throw versionMismatch(input.userId);
      }
      table.set(input.operationId, {
        operationId: input.operationId,
        userId: input.userId,
        membershipId: membership.id,
        expectedMembershipVersion: input.expectedMembershipVersion,
        state: "prepared",
        expiresAt: input.expiresAt,
      });
    },

    async renew(operationId: string, expiresAt: Date): Promise<void> {
      const row = requireLock(operationId);
      // A renewal that raced the commit must not fail the recovery loop,
      // and a committed lock has no expiry to extend.
      if (row.state === "committed") {
        return;
      }
      table.set(operationId, {
        ...row,
        expiresAt: laterOf(row.expiresAt, expiresAt),
      });
    },

    async commit(operationId: string): Promise<void> {
      const row = requireLock(operationId);
      if (row.state === "committed") {
        return;
      }
      table.set(operationId, {
        ...row,
        state: "committed",
        expiresAt: null,
      });
    },

    async release(operationId: string): Promise<void> {
      table.delete(operationId);
    },

    async hasConflict(userId: UserId): Promise<boolean> {
      return table.values().some((row) => row.userId === userId);
    },
  };
}
