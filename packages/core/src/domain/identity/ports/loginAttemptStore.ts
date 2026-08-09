import type { PrunePage } from "@repo/core/domain/common/pagination";
import type { LoginAttempt } from "../services/loginThrottlePolicy";

/**
 * Failure counter keyed by `LoginAttemptKey` (sign-in and share-password
 * verification share the table under separate namespaces).
 *
 * Contract: **`recordFailure` must be a single atomic operation — a
 * read-then-write implementation is forbidden.** The row carries no
 * optimistic lock, so a naive implementation would let parallel failures
 * read and write the same `failureCount`, defeating `LoginThrottlePolicy`
 * entirely. `recordFailure` increments the count, sets `lastFailedAt` to
 * `now` and the row expiry to `now + ttlMs`, creating the row at
 * `failureCount: 1` when absent, and returns the **post-increment**
 * state. Lock derivation stays in `LoginThrottlePolicy` so no threshold
 * rule leaks into adapter SQL.
 *
 * Error contract: `SystemError(DatabaseError)`.
 */
export interface LoginAttemptStore {
  get(key: string): Promise<LoginAttempt | null>;
  recordFailure(key: string, now: Date, ttlMs: number): Promise<LoginAttempt>;
  clear(key: string): Promise<void>;
  /** Bounded keyset sweep used by `pruneExpiredAuthState`. */
  deleteExpired(
    now: Date,
    cursor: string | null,
    limit: number,
  ): Promise<PrunePage>;
}
