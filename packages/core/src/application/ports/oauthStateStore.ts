import type { PrunePage } from "@repo/core/domain/common/pagination";
import type { TokenHash, UserId } from "@repo/core/domain/identity/valueObject";

/**
 * `provider` stays a raw string because Identity and Integration hold
 * separate enums — the consumer reconstructs its own value object.
 */
export type OAuthFlowState = Readonly<{
  provider: string;
  codeVerifier: string;
  redirectTo: string | null;
  intent: "signIn" | "linkIdentity" | "integration";
  /** Required for "linkIdentity" / "integration". */
  userId: UserId | null;
  /** Auth epoch at issue time for authenticated intents; `null` for signIn. */
  userAuthEpoch: number | null;
  /**
   * Digest of the one-shot secret handed to the browser that started the
   * flow (`SecureTokenGenerator.issue()`'s `hash`), required for every
   * intent. Opaque to the store, which knows neither where it came from
   * nor how the plaintext travels back.
   */
  stateBindingHash: TokenHash;
}>;

/**
 * Short-lived holder of the authorization-flow `state` / `codeVerifier`,
 * shared by sign-in (Identity) and external integration (Integration) —
 * which is why it lives in the application layer rather than either
 * domain. Expired rows for **both** intents are swept by Identity's
 * `pruneExpiredAuthState`.
 *
 * Contract: `take` (get + delete) **must be atomic** — e.g. a single
 * `DELETE … RETURNING`. Deletion is conditional, decided by one rule that
 * settles all four quadrants of (binding matches / does not) × (live /
 * expired):
 *
 * > The row is deleted **only** when the binding matches. On a match it is
 * > deleted even if expired, answering `null`. A mismatch always leaves the
 * > row in place and answers `null`.
 *
 * So a request that merely knows `state` cannot consume the row — that is a
 * property of the single atomic operation, not of the caller's ordering.
 * Judgement order is not normative; a backend may implement it as
 * `DELETE … WHERE state = ? AND binding_hash = ? RETURNING *` (no expiry in
 * the `WHERE`) or as read → compare → delete → expiry check.
 *
 * Error contract: `SystemError(DatabaseError)`.
 */
export interface OAuthStateStore {
  put(state: string, value: OAuthFlowState, ttlMs: number): Promise<void>;
  take(
    state: string,
    stateBindingHash: TokenHash,
  ): Promise<OAuthFlowState | null>;
  /** Bounded keyset sweep of expired rows. */
  deleteExpired(
    now: Date,
    cursor: string | null,
    limit: number,
  ): Promise<PrunePage>;
}
