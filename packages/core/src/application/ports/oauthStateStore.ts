import type { PrunePage } from "@repo/core/domain/common/pagination";
import type { UserId } from "@repo/core/domain/identity/valueObject";

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
}>;

/**
 * Short-lived holder of the authorization-flow `state` / `codeVerifier`,
 * shared by sign-in (Identity) and external integration (Integration) —
 * which is why it lives in the application layer rather than either
 * domain. Expired rows for **both** intents are swept by Identity's
 * `pruneExpiredAuthState`.
 *
 * Contract: `take` (get + delete) **must be atomic** — e.g. a single
 * `DELETE … RETURNING`.
 *
 * Error contract: `SystemError(DatabaseError)`.
 */
export interface OAuthStateStore {
  put(state: string, value: OAuthFlowState, ttlMs: number): Promise<void>;
  take(state: string): Promise<OAuthFlowState | null>;
  /** Bounded keyset sweep of expired rows. */
  deleteExpired(
    now: Date,
    cursor: string | null,
    limit: number,
  ): Promise<PrunePage>;
}
