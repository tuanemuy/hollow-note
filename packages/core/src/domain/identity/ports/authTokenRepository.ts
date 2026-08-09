import type { PrunePage } from "@repo/core/domain/common/pagination";
import type { AuthToken } from "../authToken";
import type { AuthTokenPurpose, TokenHash, UserId } from "../valueObject";

/**
 * Single consumption contract: when `save` receives a
 * `ConsumedAuthToken`, the adapter must implement it as a conditional
 * update on the `status = 'pending'` row
 * (`UPDATE ... SET status = 'consumed' WHERE id = ? AND status = 'pending'`)
 * and raise `ConflictError("AUTH_TOKEN_ALREADY_CONSUMED")` when zero rows
 * match — exactly one concurrent consumer succeeds.
 *
 * Error contract: `ConflictError("AUTH_TOKEN_ALREADY_CONSUMED")`,
 * `SystemError(DatabaseError)`.
 */
export interface AuthTokenRepository {
  insert(token: AuthToken): Promise<void>;
  findByTokenHash(
    userId: UserId,
    tokenHash: TokenHash,
  ): Promise<AuthToken | null>;
  save(token: AuthToken): Promise<void>;
  deleteByUserAndPurpose(
    userId: UserId,
    purpose: AuthTokenPurpose,
    limit: number,
  ): Promise<number>;
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
