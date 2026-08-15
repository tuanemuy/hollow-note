import type { TransactionalRepository } from "@repo/core/domain/common/transactionalRepository";
import type { Identity } from "../identity";
import type { IdentityId, UserId } from "../valueObject";

/**
 * Provider-account uniqueness is not enforced here: the claim index
 * (`IdentityUniqueDirectory`) is its only guard, and it is what raises
 * `ConflictError("PROVIDER_ACCOUNT_ALREADY_LINKED")`.
 *
 * Error contract: `ConflictError("OPTIMISTIC_LOCK_FAILURE")`,
 * `SystemError(DatabaseError)`.
 */
export interface IdentityRepository
  extends TransactionalRepository<Identity, IdentityId> {
  /** At most 8 rows by the `IdentityPolicy` invariant. */
  listByUserId(userId: UserId): Promise<readonly Identity[]>;
}
