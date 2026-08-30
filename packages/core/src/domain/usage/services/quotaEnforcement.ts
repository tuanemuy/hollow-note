import { BusinessRuleError } from "@repo/core/domain/error";
import { UsageErrorCode } from "../errorCode";
import { LlmUsage } from "../llmUsage";
import { StorageQuota } from "../storageQuota";
import {
  type BillingPeriod,
  LlmCallQuota,
  type UsageWarningLevel,
} from "../valueObject";

export type DescribedStorageUsage = Readonly<{
  consumedBytes: number;
  limitBytes: number;
  noteCount: number;
  level: UsageWarningLevel;
}>;

export type DescribedLlmUsage = Readonly<{
  consumedCalls: number;
  limitCalls: number;
  period: BillingPeriod;
  level: UsageWarningLevel;
}>;

export type UsageSnapshot<
  TLlm extends DescribedLlmUsage | null = DescribedLlmUsage | null,
> = Readonly<{
  storage: DescribedStorageUsage;
  llm: TLlm;
}>;

/**
 * Both halves of what a usage screen shows, derived here and nowhere
 * else. The first overload is what keeps that true: a caller that has
 * already resolved "no row yet" into an initialized period gets the LLM
 * half back non-null, so it never has to re-derive the four figures just
 * to escape the null the second overload carries.
 */
function describe(
  params: Readonly<{ storage: StorageQuota; llm: LlmUsage }>,
): UsageSnapshot<DescribedLlmUsage>;
function describe(
  params: Readonly<{ storage: StorageQuota; llm: LlmUsage | null }>,
): UsageSnapshot;
function describe(
  params: Readonly<{ storage: StorageQuota; llm: LlmUsage | null }>,
): UsageSnapshot {
  return {
    storage: {
      consumedBytes: params.storage.consumedBytes,
      limitBytes: params.storage.quota.limit,
      noteCount: params.storage.noteCount,
      level: StorageQuota.warningLevel(params.storage),
    },
    llm:
      params.llm === null
        ? null
        : {
            consumedCalls: params.llm.consumedCalls,
            limitCalls: params.llm.quota.limit,
            period: params.llm.period,
            level: LlmUsage.warningLevel(params.llm),
          },
  };
}

/**
 * Joint check of capacity and LLM allowance, applied at intake only.
 *
 * Moving a note between subjects is never checked: the bytes are already
 * in the service, so a move adds nothing to the total, and refusing one
 * would trap a user inside an over-quota subject. Being over quota shows
 * up as a warning level and as refused uploads.
 *
 * A missing `LlmUsage` means "no call yet this month", not "no
 * allowance": the row is first created by `consumeLlmCall`, so reading
 * absence as exhaustion would refuse every new user's first upload.
 */
export const QuotaEnforcement = {
  ensureUploadAllowed: (
    params: Readonly<{
      storage: StorageQuota;
      llm: LlmUsage | null;
      totalBytes: number;
      llmCalls: number;
    }>,
  ): void => {
    StorageQuota.ensureCanStore(params.storage, params.totalBytes);
    if (params.llmCalls <= 0) {
      return;
    }
    if (params.llm !== null) {
      LlmUsage.ensureCanCall(params.llm, params.llmCalls);
      return;
    }
    if (params.llmCalls > LlmCallQuota.default().limit) {
      throw new BusinessRuleError(
        UsageErrorCode.LlmQuotaExceeded,
        "LLM call quota exceeded",
      );
    }
  },

  describe,
};
