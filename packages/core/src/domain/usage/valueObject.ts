import { BusinessRuleError } from "@repo/core/domain/error";
import type { UserId } from "@repo/core/domain/identity/valueObject";
import type { NoteOwner } from "@repo/core/domain/note/valueObject";
import type { StorageOwner } from "@repo/core/domain/storage/valueObject";
import type { WorkspaceId } from "@repo/core/domain/workspace/valueObject";
import { UsageErrorCode } from "./errorCode";

export type QuotaSubject =
  | Readonly<{ type: "user"; userId: UserId }>
  | Readonly<{ type: "workspace"; workspaceId: WorkspaceId }>;

export const QuotaSubject = {
  user: (userId: UserId): QuotaSubject => ({ type: "user", userId }),
  workspace: (workspaceId: WorkspaceId): QuotaSubject => ({
    type: "workspace",
    workspaceId,
  }),
  fromStorageOwner: (owner: StorageOwner): QuotaSubject =>
    owner.type === "user"
      ? QuotaSubject.user(owner.userId)
      : QuotaSubject.workspace(owner.workspaceId),
  fromNoteOwner: (owner: NoteOwner): QuotaSubject =>
    owner.type === "user"
      ? QuotaSubject.user(owner.userId)
      : QuotaSubject.workspace(owner.workspaceId),
  equals: (a: QuotaSubject, b: QuotaSubject): boolean =>
    a.type === "user"
      ? b.type === "user" && a.userId === b.userId
      : b.type === "workspace" && a.workspaceId === b.workspaceId,
};

const GIB = 1024 * 1024 * 1024;
const USER_STORAGE_LIMIT_BYTES = 5 * GIB;
const WORKSPACE_STORAGE_LIMIT_BYTES = 20 * GIB;

export type ByteQuota = Readonly<{ limit: number }>;

export const ByteQuota = {
  create: (limit: number): ByteQuota => {
    if (!Number.isInteger(limit) || limit <= 0) {
      throw new BusinessRuleError(
        UsageErrorCode.InvalidQuota,
        `Invalid byte quota: ${limit}`,
      );
    }
    return { limit };
  },
  defaultFor: (subject: QuotaSubject): ByteQuota =>
    ByteQuota.create(
      subject.type === "user"
        ? USER_STORAGE_LIMIT_BYTES
        : WORKSPACE_STORAGE_LIMIT_BYTES,
    ),
};

const DEFAULT_LLM_CALLS_PER_MONTH = 300;

export type LlmCallQuota = Readonly<{ limit: number }>;

/** Per user, even for conversions of a workspace-owned note. */
export const LlmCallQuota = {
  create: (limit: number): LlmCallQuota => {
    if (!Number.isInteger(limit) || limit < 0) {
      throw new BusinessRuleError(
        UsageErrorCode.InvalidQuota,
        `Invalid LLM call quota: ${limit}`,
      );
    }
    return { limit };
  },
  default: (): LlmCallQuota => LlmCallQuota.create(DEFAULT_LLM_CALLS_PER_MONTH),
};

export type BillingPeriod = Readonly<{ year: number; month: number }>;

/** Calendar month in UTC, so a period never depends on the reader. */
export const BillingPeriod = {
  create: (year: number, month: number): BillingPeriod => {
    if (
      !Number.isInteger(year) ||
      !Number.isInteger(month) ||
      month < 1 ||
      month > 12
    ) {
      throw new BusinessRuleError(
        UsageErrorCode.InvalidPeriod,
        `Invalid billing period: ${year}-${month}`,
      );
    }
    return { year, month };
  },
  of: (date: Date): BillingPeriod =>
    BillingPeriod.create(date.getUTCFullYear(), date.getUTCMonth() + 1),
  equals: (a: BillingPeriod, b: BillingPeriod): boolean =>
    a.year === b.year && a.month === b.month,
};

export type UsageWarningLevel = "none" | "warning" | "exceeded";

const WARNING_RATIO = 0.8;

export const UsageWarningLevel = {
  of: (consumed: number, limit: number): UsageWarningLevel => {
    // A zero limit admits nothing, so any state of it is already over.
    if (limit <= 0 || consumed >= limit) {
      return "exceeded";
    }
    return consumed >= limit * WARNING_RATIO ? "warning" : "none";
  },
};
