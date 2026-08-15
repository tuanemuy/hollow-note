export const UsageErrorCode = {
  InvalidDelta: "USAGE_INVALID_DELTA",
  InvalidQuota: "USAGE_INVALID_QUOTA",
  InvalidPeriod: "USAGE_INVALID_PERIOD",
  StorageQuotaExceeded: "USAGE_STORAGE_QUOTA_EXCEEDED",
  LlmQuotaExceeded: "USAGE_LLM_QUOTA_EXCEEDED",
} as const;

export type UsageErrorCode =
  (typeof UsageErrorCode)[keyof typeof UsageErrorCode];
