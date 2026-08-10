import type { TransactionalRepository } from "@repo/core/domain/common/transactionalRepository";
import type { User } from "../user";
import type { UserId } from "../valueObject";

/**
 * OCC-enforced persistence for the `User` aggregate, bound to the current
 * UserId shard — it never accepts ids from another shard.
 *
 * Error contract: `ConflictError("OPTIMISTIC_LOCK_FAILURE")` on version
 * mismatch, `ConflictError("EMAIL_ALREADY_USED")` /
 * `ConflictError("HANDLE_ALREADY_USED")` on uniqueness violations,
 * `SystemError(DatabaseError)` otherwise.
 */
export interface UserRepository extends TransactionalRepository<User, UserId> {}
