export type LoginAttempt = Readonly<{
  key: string;
  failureCount: number;
  lastFailedAt: Date | null;
}>;

export type ThrottleDecision =
  | Readonly<{ kind: "allow" }>
  | Readonly<{ kind: "delay"; waitMs: number }>
  | Readonly<{ kind: "locked"; until: Date }>;

const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;
const HOUR_MS = 60 * MINUTE_MS;

/**
 * Pure derivation of wait / lock from the failure record. Nothing is
 * stored for the lock itself: `recordFailure` must be a single atomic
 * write (see `LoginAttemptStore`), which forbids the written value from
 * depending on the value read — so the threshold rules live here, in one
 * place, instead of leaking into adapter SQL.
 *
 * Rules: from the 3rd attempt on, wait `2^(failureCount-2)` seconds
 * (capped at `maxDelayMs`); at `failureCount >= lockThreshold` and within
 * `lockDurationMs` of the last failure, the key is locked until
 * `lastFailedAt + lockDurationMs`.
 *
 * Read/write choreography (spec/domains/identity.md): the caller reads
 * via `LoginAttemptStore.get` (falling back to `initial`), evaluates,
 * records failures via the atomic `recordFailure` (re-evaluating its
 * return value for the response), and clears on success. Stale reads at
 * step 1 are harmless — the failed attempt is still counted atomically.
 */
export const LoginThrottlePolicy = {
  lockThreshold: 10,
  lockDurationMs: 15 * MINUTE_MS,
  maxDelayMs: 60 * SECOND_MS,
  /**
   * Kept well above `lockDurationMs` so an in-lock record cannot expire
   * out from under the lock; bounded so `pruneExpiredAuthState` can
   * eventually reclaim rows.
   */
  attemptTtlMs: 24 * HOUR_MS,

  initial: (key: string): LoginAttempt => ({
    key,
    failureCount: 0,
    lastFailedAt: null,
  }),

  evaluate: (attempt: LoginAttempt, now: Date): ThrottleDecision => {
    if (attempt.lastFailedAt === null || attempt.failureCount < 2) {
      return { kind: "allow" };
    }
    const lastFailedMs = attempt.lastFailedAt.getTime();
    if (attempt.failureCount >= LoginThrottlePolicy.lockThreshold) {
      const until = lastFailedMs + LoginThrottlePolicy.lockDurationMs;
      if (now.getTime() < until) {
        return { kind: "locked", until: new Date(until) };
      }
    }
    const waitMs = Math.min(
      2 ** (attempt.failureCount - 2) * SECOND_MS,
      LoginThrottlePolicy.maxDelayMs,
    );
    const remainingMs = lastFailedMs + waitMs - now.getTime();
    if (remainingMs > 0) {
      return { kind: "delay", waitMs: remainingMs };
    }
    return { kind: "allow" };
  },
};
