import { isBusinessRuleError } from "@repo/core/domain/error";
import { UserId } from "@repo/core/domain/identity/valueObject";
import { NoteOwner } from "@repo/core/domain/note/valueObject";
import { WorkspaceId } from "@repo/core/domain/workspace/valueObject";
import { describe, expect, it } from "vitest";
import { UsageErrorCode } from "../errorCode";
import {
  BillingPeriod,
  ByteQuota,
  LlmCallQuota,
  QuotaSubject,
  UsageWarningLevel,
} from "../valueObject";

const codeOf = (fn: () => unknown): string | null => {
  try {
    fn();
    return null;
  } catch (error) {
    return isBusinessRuleError(error) ? error.code : null;
  }
};

const GIB = 1024 * 1024 * 1024;

describe("DOM-usage-001: QuotaSubject", () => {
  it("derives a subject from a note owner of either kind", () => {
    expect(
      QuotaSubject.fromNoteOwner(NoteOwner.user(UserId.create("u1"))),
    ).toEqual({ type: "user", userId: "u1" });
    expect(
      QuotaSubject.fromNoteOwner(NoteOwner.workspace(WorkspaceId.create("w1"))),
    ).toEqual({ type: "workspace", workspaceId: "w1" });
  });

  it("compares subjects across kinds", () => {
    const user = QuotaSubject.user(UserId.create("u1"));
    expect(
      QuotaSubject.equals(user, QuotaSubject.user(UserId.create("u1"))),
    ).toBe(true);
    expect(
      QuotaSubject.equals(user, QuotaSubject.user(UserId.create("u2"))),
    ).toBe(false);
    expect(
      QuotaSubject.equals(
        user,
        QuotaSubject.workspace(WorkspaceId.create("u1")),
      ),
    ).toBe(false);
  });
});

describe("DOM-usage-002: ByteQuota", () => {
  it("defaults to 5 GiB per user and 20 GiB per workspace", () => {
    expect(
      ByteQuota.defaultFor(QuotaSubject.user(UserId.create("u1"))).limit,
    ).toBe(5 * GIB);
    expect(
      ByteQuota.defaultFor(QuotaSubject.workspace(WorkspaceId.create("w1")))
        .limit,
    ).toBe(20 * GIB);
  });

  it("rejects a zero, negative, or fractional limit", () => {
    expect(codeOf(() => ByteQuota.create(0))).toBe(UsageErrorCode.InvalidQuota);
    expect(codeOf(() => ByteQuota.create(-1))).toBe(
      UsageErrorCode.InvalidQuota,
    );
    expect(codeOf(() => ByteQuota.create(1.5))).toBe(
      UsageErrorCode.InvalidQuota,
    );
  });
});

describe("DOM-usage-003: LlmCallQuota", () => {
  it("defaults to 300 calls a month and admits zero as a limit", () => {
    expect(LlmCallQuota.default().limit).toBe(300);
    expect(LlmCallQuota.create(0).limit).toBe(0);
    expect(codeOf(() => LlmCallQuota.create(-1))).toBe(
      UsageErrorCode.InvalidQuota,
    );
  });
});

describe("DOM-usage-004: BillingPeriod", () => {
  it("reads the calendar month in UTC, not in the local zone", () => {
    expect(BillingPeriod.of(new Date("2026-05-31T23:59:59.999Z"))).toEqual({
      year: 2026,
      month: 5,
    });
    expect(BillingPeriod.of(new Date("2026-06-01T00:00:00.000Z"))).toEqual({
      year: 2026,
      month: 6,
    });
  });

  it("rejects a month outside 1..12", () => {
    expect(codeOf(() => BillingPeriod.create(2026, 0))).toBe(
      UsageErrorCode.InvalidPeriod,
    );
    expect(codeOf(() => BillingPeriod.create(2026, 13))).toBe(
      UsageErrorCode.InvalidPeriod,
    );
  });

  it("compares periods by year and month", () => {
    expect(
      BillingPeriod.equals(
        BillingPeriod.create(2026, 5),
        BillingPeriod.create(2026, 5),
      ),
    ).toBe(true);
    expect(
      BillingPeriod.equals(
        BillingPeriod.create(2026, 5),
        BillingPeriod.create(2025, 5),
      ),
    ).toBe(false);
  });
});

describe("DOM-usage-005: UsageWarningLevel", () => {
  it("switches at 80% and at 100%", () => {
    expect(UsageWarningLevel.of(79, 100)).toBe("none");
    expect(UsageWarningLevel.of(80, 100)).toBe("warning");
    expect(UsageWarningLevel.of(99, 100)).toBe("warning");
    expect(UsageWarningLevel.of(100, 100)).toBe("exceeded");
    expect(UsageWarningLevel.of(101, 100)).toBe("exceeded");
  });
});
