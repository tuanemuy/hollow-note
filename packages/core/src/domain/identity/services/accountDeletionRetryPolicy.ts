import { BusinessRuleError } from "@repo/core/domain/error";
import { IdentityErrorCode } from "../errorCode";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * How many account-deletion attempts one user may leave behind.
 *
 * Terminal control-plane rows are retained for 120 days, so an unbounded
 * retry loop would accumulate them; the cap keeps a user's retained
 * terminal rows at 8. The threshold and the window live here — the store
 * only observes the count (`DistributedOperationStore.countTerminalSince`)
 * so the numbers are not copied into every backend.
 *
 * Admission counts, then decides, then creates: an operation is never
 * created and rolled back.
 */
export const AccountDeletionRetryPolicy = {
  retentionWindowMs: 120 * DAY_MS,
  maxTerminalAttempts: 8,

  windowStart: (now: Date): Date =>
    new Date(now.getTime() - AccountDeletionRetryPolicy.retentionWindowMs),

  ensureRetryable: (terminalCount: number): void => {
    if (terminalCount >= AccountDeletionRetryPolicy.maxTerminalAttempts) {
      throw new BusinessRuleError(
        IdentityErrorCode.AccountDeletionRetryLimitExceeded,
        `At most ${AccountDeletionRetryPolicy.maxTerminalAttempts} deletion attempts are retained per user`,
      );
    }
  },
};
