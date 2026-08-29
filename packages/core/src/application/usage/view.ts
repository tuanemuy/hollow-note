import type { DescribedLlmUsage } from "@repo/core/domain/usage/services/quotaEnforcement";

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

export type AvailableWorkspaceUsageView = Readonly<{
  state: "available";
  workspaceId: string;
  workspaceName: string;
  consumedBytes: number;
  limitBytes: number;
  noteCount: number;
  level: UsageLevelView;
}>;

/**
 * A workspace whose figures could not be read for this request. Kept in
 * the list rather than dropped: one unreachable scope object must degrade
 * a single row, not the whole screen
 * (spec/usecases/usage.md#getusagesnapshot 手順 3).
 *
 * `workspaceName` is nullable because the display name comes from the
 * global `workspace_directory`, and that read degrades per row too — a
 * directory shard that cannot answer leaves the membership edge without
 * a name to show.
 */
export type UnavailableWorkspaceUsageView = Readonly<{
  state: "unavailable";
  workspaceId: string;
  workspaceName: string | null;
}>;

export type WorkspaceUsageView =
  | AvailableWorkspaceUsageView
  | UnavailableWorkspaceUsageView;

export type UsageSnapshotView = Readonly<{
  personal: PersonalUsageView;
  llm: LlmUsageView;
  workspaces: readonly WorkspaceUsageView[];
  nextWorkspaceCursor: string | null;
  updatedAt: Date;
}>;

/**
 * Takes the half `QuotaEnforcement.describe` already derived rather than
 * the entity: the display figures and the warning level are the domain
 * service's to decide, and re-reading them off `LlmUsage` here would give
 * that rule a second home to drift from.
 */
export const toLlmUsageView = (described: DescribedLlmUsage): LlmUsageView => ({
  consumedCalls: described.consumedCalls,
  limitCalls: described.limitCalls,
  period: { year: described.period.year, month: described.period.month },
  level: described.level,
});

export type RecalculatedStorageUsageView = Readonly<{
  consumedBytes: number;
  noteCount: number;
}>;
