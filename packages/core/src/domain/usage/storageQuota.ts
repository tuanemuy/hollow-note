import { Version } from "@repo/core/domain/common/version";
import { BusinessRuleError } from "@repo/core/domain/error";
import { UsageErrorCode } from "./errorCode";
import { ByteQuota, type QuotaSubject, UsageWarningLevel } from "./valueObject";

/** The subject is the identity — there is no separate id. */
export type StorageQuota = Readonly<{
  subject: QuotaSubject;
  quota: ByteQuota;
  consumedBytes: number;
  noteCount: number;
  version: Version;
  updatedAt: Date;
}>;

const ensureNonNegativeDelta = (value: number, what: string): void => {
  if (!Number.isInteger(value) || value < 0) {
    throw new BusinessRuleError(
      UsageErrorCode.InvalidDelta,
      `Invalid ${what}: ${value}`,
    );
  }
};

export const StorageQuota = {
  initialize: (subject: QuotaSubject, now: Date): StorageQuota => ({
    subject,
    quota: ByteQuota.defaultFor(subject),
    consumedBytes: 0,
    noteCount: 0,
    version: Version.initial(),
    updatedAt: now,
  }),

  add: (quota: StorageQuota, bytes: number, now: Date): StorageQuota => {
    ensureNonNegativeDelta(bytes, "byte delta");
    return {
      ...quota,
      consumedBytes: quota.consumedBytes + bytes,
      version: Version.next(quota.version),
      updatedAt: now,
    };
  },

  /**
   * Floors at zero as a defence, not as an idempotence mechanism —
   * duplicate deliveries are rejected by the subscriber's
   * `IdempotencyStore` (spec/domains/usage.md).
   */
  subtract: (quota: StorageQuota, bytes: number, now: Date): StorageQuota => {
    ensureNonNegativeDelta(bytes, "byte delta");
    return {
      ...quota,
      consumedBytes: Math.max(0, quota.consumedBytes - bytes),
      version: Version.next(quota.version),
      updatedAt: now,
    };
  },

  incrementNotes: (quota: StorageQuota, now: Date): StorageQuota => ({
    ...quota,
    noteCount: quota.noteCount + 1,
    version: Version.next(quota.version),
    updatedAt: now,
  }),

  decrementNotes: (quota: StorageQuota, now: Date): StorageQuota => ({
    ...quota,
    noteCount: Math.max(0, quota.noteCount - 1),
    version: Version.next(quota.version),
    updatedAt: now,
  }),

  /** Stocktaking overwrite used by `recalculateStorageUsage`, where the
   * scan result — not a delta — is the authority. */
  replaceTotals: (
    quota: StorageQuota,
    totals: Readonly<{ consumedBytes: number; noteCount: number }>,
    now: Date,
  ): StorageQuota => {
    ensureNonNegativeDelta(totals.consumedBytes, "consumed bytes");
    ensureNonNegativeDelta(totals.noteCount, "note count");
    return {
      ...quota,
      consumedBytes: totals.consumedBytes,
      noteCount: totals.noteCount,
      version: Version.next(quota.version),
      updatedAt: now,
    };
  },

  changeLimit: (
    quota: StorageQuota,
    limit: ByteQuota,
    now: Date,
  ): StorageQuota => ({
    ...quota,
    quota: limit,
    version: Version.next(quota.version),
    updatedAt: now,
  }),

  headroom: (quota: StorageQuota): number =>
    Math.max(0, quota.quota.limit - quota.consumedBytes),

  warningLevel: (quota: StorageQuota): UsageWarningLevel =>
    UsageWarningLevel.of(quota.consumedBytes, quota.quota.limit),

  ensureCanStore: (quota: StorageQuota, bytes: number): void => {
    if (StorageQuota.headroom(quota) < bytes) {
      throw new BusinessRuleError(
        UsageErrorCode.StorageQuotaExceeded,
        "Storage quota exceeded",
      );
    }
  },
};
