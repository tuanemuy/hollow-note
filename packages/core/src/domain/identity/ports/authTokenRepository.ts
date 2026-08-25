import type { PrunePage } from "@repo/core/domain/common/pagination";
import type { AuthToken, PendingAuthToken } from "../authToken";
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
  /**
   * A live token of the pair. It is the only reading of when a token was
   * last issued to a user, which is what the resend intervals of
   * `resendVerificationEmail` and `requestPasswordReset` are measured
   * from.
   *
   * More than one pending token of the same pair may exist. Keeping the
   * count at one belongs to the caller, which issues a new token only
   * after `deleteByUserAndPurpose`; no storage-level uniqueness enforces
   * it, and a backend that adds one breaks this contract. **Which row is
   * returned while several are pending is undefined** — backends differ,
   * so a caller must not build a rule on top of the choice.
   */
  findPendingByUserAndPurpose(
    userId: UserId,
    purpose: AuthTokenPurpose,
  ): Promise<PendingAuthToken | null>;
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
