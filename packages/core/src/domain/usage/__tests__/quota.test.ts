import { isBusinessRuleError } from "@repo/core/domain/error";
import { UserId } from "@repo/core/domain/identity/valueObject";
import { describe, expect, it } from "vitest";
import { UsageErrorCode } from "../errorCode";
import { LlmUsage } from "../llmUsage";
import { QuotaEnforcement } from "../services/quotaEnforcement";
import { StorageQuota } from "../storageQuota";
import { BillingPeriod, ByteQuota, QuotaSubject } from "../valueObject";

const NOW = new Date("2026-05-01T00:00:00.000Z");
const LATER = new Date("2026-05-02T00:00:00.000Z");
const subject = QuotaSubject.user(UserId.create("u1"));
const userId = UserId.create("u1");
const period = BillingPeriod.of(NOW);

const codeOf = (fn: () => unknown): string | null => {
  try {
    fn();
    return null;
  } catch (error) {
    return isBusinessRuleError(error) ? error.code : null;
  }
};

const quotaOf = (consumedBytes: number, limit = 1000): StorageQuota =>
  StorageQuota.changeLimit(
    StorageQuota.add(StorageQuota.initialize(subject, NOW), consumedBytes, NOW),
    ByteQuota.create(limit),
    NOW,
  );

describe("DOM-usage-006: StorageQuota", () => {
  it("starts empty with the subject's default limit", () => {
    const quota = StorageQuota.initialize(subject, NOW);
    expect(quota.consumedBytes).toBe(0);
    expect(quota.noteCount).toBe(0);
    expect(quota.quota.limit).toBe(5 * 1024 * 1024 * 1024);
    expect(quota.version).toBe(0);
  });

  it("adds and subtracts bytes, flooring at zero and bumping the version", () => {
    const added = StorageQuota.add(
      StorageQuota.initialize(subject, NOW),
      500,
      LATER,
    );
    expect(added.consumedBytes).toBe(500);
    expect(added.version).toBe(1);
    expect(added.updatedAt).toEqual(LATER);

    expect(StorageQuota.subtract(added, 200, LATER).consumedBytes).toBe(300);
    expect(StorageQuota.subtract(added, 900, LATER).consumedBytes).toBe(0);
  });

  it("rejects a negative or fractional delta", () => {
    const quota = StorageQuota.initialize(subject, NOW);
    expect(codeOf(() => StorageQuota.add(quota, -1, NOW))).toBe(
      UsageErrorCode.InvalidDelta,
    );
    expect(codeOf(() => StorageQuota.subtract(quota, 1.5, NOW))).toBe(
      UsageErrorCode.InvalidDelta,
    );
  });

  it("counts notes without going below zero", () => {
    const quota = StorageQuota.initialize(subject, NOW);
    expect(StorageQuota.incrementNotes(quota, NOW).noteCount).toBe(1);
    expect(StorageQuota.decrementNotes(quota, NOW).noteCount).toBe(0);
  });

  it("replaces both totals from a stocktaking scan", () => {
    const replaced = StorageQuota.replaceTotals(
      quotaOf(500),
      { consumedBytes: 42, noteCount: 3 },
      LATER,
    );
    expect(replaced.consumedBytes).toBe(42);
    expect(replaced.noteCount).toBe(3);
    expect(
      codeOf(() =>
        StorageQuota.replaceTotals(
          quotaOf(500),
          { consumedBytes: -1, noteCount: 0 },
          LATER,
        ),
      ),
    ).toBe(UsageErrorCode.InvalidDelta);
  });

  it("reports headroom and the warning level at the 80% / 100% boundaries", () => {
    expect(StorageQuota.headroom(quotaOf(400))).toBe(600);
    expect(StorageQuota.headroom(quotaOf(1200))).toBe(0);
    expect(StorageQuota.warningLevel(quotaOf(799))).toBe("none");
    expect(StorageQuota.warningLevel(quotaOf(800))).toBe("warning");
    expect(StorageQuota.warningLevel(quotaOf(1000))).toBe("exceeded");
  });

  it("admits a store exactly up to the headroom", () => {
    expect(
      codeOf(() => StorageQuota.ensureCanStore(quotaOf(900), 100)),
    ).toBeNull();
    expect(codeOf(() => StorageQuota.ensureCanStore(quotaOf(900), 101))).toBe(
      UsageErrorCode.StorageQuotaExceeded,
    );
  });
});

describe("DOM-usage-007: LlmUsage", () => {
  it("starts at zero with the default monthly quota", () => {
    const usage = LlmUsage.initialize(userId, period, NOW);
    expect(usage.consumedCalls).toBe(0);
    expect(usage.quota.limit).toBe(300);
    expect(usage.period).toEqual({ year: 2026, month: 5 });
  });

  it("consumes calls and rejects a non-positive delta", () => {
    const usage = LlmUsage.initialize(userId, period, NOW);
    expect(LlmUsage.consume(usage, 2, LATER).consumedCalls).toBe(2);
    expect(codeOf(() => LlmUsage.consume(usage, 0, NOW))).toBe(
      UsageErrorCode.InvalidDelta,
    );
    expect(codeOf(() => LlmUsage.consume(usage, -1, NOW))).toBe(
      UsageErrorCode.InvalidDelta,
    );
  });

  it("reports headroom and warning level, and refuses a call past the limit", () => {
    const usage = LlmUsage.consume(
      LlmUsage.initialize(userId, period, NOW),
      240,
      NOW,
    );
    expect(LlmUsage.headroom(usage)).toBe(60);
    expect(LlmUsage.warningLevel(usage)).toBe("warning");
    expect(codeOf(() => LlmUsage.ensureCanCall(usage, 60))).toBeNull();
    expect(codeOf(() => LlmUsage.ensureCanCall(usage, 61))).toBe(
      UsageErrorCode.LlmQuotaExceeded,
    );
  });
});

describe("DOM-usage-008: QuotaEnforcement", () => {
  it("checks storage and, when calls are requested, the LLM allowance", () => {
    const storage = quotaOf(900);
    const llm = LlmUsage.consume(
      LlmUsage.initialize(userId, period, NOW),
      299,
      NOW,
    );

    expect(
      codeOf(() =>
        QuotaEnforcement.ensureUploadAllowed({
          storage,
          llm,
          totalBytes: 100,
          llmCalls: 1,
        }),
      ),
    ).toBeNull();
    expect(
      codeOf(() =>
        QuotaEnforcement.ensureUploadAllowed({
          storage,
          llm,
          totalBytes: 101,
          llmCalls: 0,
        }),
      ),
    ).toBe(UsageErrorCode.StorageQuotaExceeded);
    expect(
      codeOf(() =>
        QuotaEnforcement.ensureUploadAllowed({
          storage,
          llm,
          totalBytes: 100,
          llmCalls: 2,
        }),
      ),
    ).toBe(UsageErrorCode.LlmQuotaExceeded);
  });

  it("treats a missing LLM record as an unused month, not an exhausted one", () => {
    expect(
      codeOf(() =>
        QuotaEnforcement.ensureUploadAllowed({
          storage: quotaOf(0),
          llm: null,
          totalBytes: 10,
          llmCalls: 1,
        }),
      ),
    ).toBeNull();
    expect(
      codeOf(() =>
        QuotaEnforcement.ensureUploadAllowed({
          storage: quotaOf(0),
          llm: null,
          totalBytes: 10,
          llmCalls: 301,
        }),
      ),
    ).toBe(UsageErrorCode.LlmQuotaExceeded);
  });

  it("describes both sides for display, and reports a missing LLM record as null", () => {
    const storage = StorageQuota.incrementNotes(quotaOf(800), NOW);
    expect(
      QuotaEnforcement.describe({
        storage,
        llm: LlmUsage.initialize(userId, period, NOW),
      }),
    ).toEqual({
      storage: {
        consumedBytes: 800,
        limitBytes: 1000,
        noteCount: 1,
        level: "warning",
      },
      llm: {
        consumedCalls: 0,
        limitCalls: 300,
        period: { year: 2026, month: 5 },
        level: "none",
      },
    });
    expect(QuotaEnforcement.describe({ storage, llm: null }).llm).toBeNull();
  });
});
