import type { PrunePage } from "@repo/core/domain/common/pagination";
import type { Session } from "../session";
import type { SessionId, TokenHash, UserId } from "../valueObject";

/**
 * No `save`: a session has no mutable fields after creation (absolute
 * expiry). `refreshAuthEpoch` is the single conditional update that
 * follows the current session to a new auth epoch
 * (`signOutOtherSessions` / `changePassword`).
 *
 * Error contract: `SystemError(DatabaseError)`.
 */
export interface SessionRepository {
  insert(session: Session): Promise<void>;
  findByTokenHash(
    userId: UserId,
    tokenHash: TokenHash,
  ): Promise<Session | null>;
  deleteById(id: SessionId): Promise<void>;
  refreshAuthEpoch(
    id: SessionId,
    userId: UserId,
    authEpoch: number,
  ): Promise<void>;
  /** Bounded deletion of sessions minted under an epoch older than `currentEpoch`. */
  deleteOlderEpochByUser(
    userId: UserId,
    currentEpoch: number,
    limit: number,
  ): Promise<number>;
  /** Bounded keyset sweep of rows with `expiresAt <= now`. */
  deleteExpired(
    now: Date,
    cursor: string | null,
    limit: number,
  ): Promise<PrunePage>;
}
