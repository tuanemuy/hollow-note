import type { Versioned } from "@repo/core/domain/common/transactionalRepository";
import type { User } from "../user";
import type { UserId } from "../valueObject";

/**
 * Shard-spanning batch read of users (max 100 input ids). Implementations
 * group ids per hash shard and read in bounded waves (max 6 concurrent
 * connections); during a reshard both old and new generations are read
 * and the higher-version row wins per UserId. Routing is direct from the
 * input ids — never a full shard scan.
 *
 * Error contract: `SystemError(DatabaseError)` — including an input over
 * the 100-id cap, which is a caller programming error rather than a
 * concurrent-state conflict (same contract as
 * `NoteRouteStore.resolveMany`).
 */
export interface UserBatchReader {
  resolveMany(
    ids: readonly UserId[],
  ): Promise<ReadonlyMap<UserId, Versioned<User>>>;
}
