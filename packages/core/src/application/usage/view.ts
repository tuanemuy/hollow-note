import { LlmUsage } from "@repo/core/domain/usage/llmUsage";

/**
 * DTO projections for the usage usecases. Fields are primitives only;
 * branded value objects widen naturally, so projection needs no casts.
 */

export type UsageLevelView = "none" | "warning" | "exceeded";

export type PersonalUsageView = Readonly<{
  consumedBytes: number;
  limitBytes: number;
  noteCount: number;
  level: UsageLevelView;
}>;

export type LlmUsageView = Readonly<{
  consumedCalls: number;
  limitCalls: number;
  period: Readonly<{ year: number; month: number }>;
  level: UsageLevelView;
}>;

export type UsageSnapshotView = Readonly<{
  personal: PersonalUsageView;
  llm: LlmUsageView;
  /**
   * Workspace usage. This slice has no port that enumerates the viewer's
   * memberships and resolves workspace names, so the list is always
   * empty and carries no element type; the slice that adds the keyset
   * paging widens it along with the cursor field it needs.
   */
  workspaces: readonly never[];
  updatedAt: Date;
}>;

export const toLlmUsageView = (usage: LlmUsage): LlmUsageView => ({
  consumedCalls: usage.consumedCalls,
  limitCalls: usage.quota.limit,
  period: { year: usage.period.year, month: usage.period.month },
  level: LlmUsage.warningLevel(usage),
});

export type RecalculatedStorageUsageView = Readonly<{
  consumedBytes: number;
  noteCount: number;
}>;
