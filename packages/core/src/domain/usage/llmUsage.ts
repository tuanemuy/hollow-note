import { Version } from "@repo/core/domain/common/version";
import { BusinessRuleError } from "@repo/core/domain/error";
import type { UserId } from "@repo/core/domain/identity/valueObject";
import { UsageErrorCode } from "./errorCode";
import {
  type BillingPeriod,
  LlmCallQuota,
  UsageWarningLevel,
} from "./valueObject";

/** `(userId, period)` is the identity. Past periods are never rewritten. */
export type LlmUsage = Readonly<{
  userId: UserId;
  period: BillingPeriod;
  quota: LlmCallQuota;
  consumedCalls: number;
  version: Version;
  updatedAt: Date;
}>;

export const LlmUsage = {
  initialize: (userId: UserId, period: BillingPeriod, now: Date): LlmUsage => ({
    userId,
    period,
    quota: LlmCallQuota.default(),
    consumedCalls: 0,
    version: Version.initial(),
    updatedAt: now,
  }),

  consume: (usage: LlmUsage, calls: number, now: Date): LlmUsage => {
    if (!Number.isInteger(calls) || calls < 1) {
      throw new BusinessRuleError(
        UsageErrorCode.InvalidDelta,
        `Invalid LLM call delta: ${calls}`,
      );
    }
    return {
      ...usage,
      consumedCalls: usage.consumedCalls + calls,
      version: Version.next(usage.version),
      updatedAt: now,
    };
  },

  headroom: (usage: LlmUsage): number =>
    Math.max(0, usage.quota.limit - usage.consumedCalls),

  warningLevel: (usage: LlmUsage): UsageWarningLevel =>
    UsageWarningLevel.of(usage.consumedCalls, usage.quota.limit),

  ensureCanCall: (usage: LlmUsage, calls: number): void => {
    if (LlmUsage.headroom(usage) < calls) {
      throw new BusinessRuleError(
        UsageErrorCode.LlmQuotaExceeded,
        "LLM call quota exceeded",
      );
    }
  },
};
