import type { Versioned } from "@repo/core/domain/common/transactionalRepository";
import type { WorkspaceId, WorkspaceName, WorkspaceSlug } from "../valueObject";
import type { Workspace } from "../workspace";

/**
 * Display projection of a workspace held in the global
 * `workspace_directory`.
 *
 * `avatarUrl` stays a raw string rather than `AvatarUrl`: the value was
 * validated when it was written, and rehydrating it would need the app
 * origin, which no read path may reach for (ADR 051 — the same reasoning
 * `Workspace.reconstruct` applies to its own `avatarUrl`).
 */
export type WorkspaceDirectoryEntry = Readonly<{
  workspaceId: WorkspaceId;
  name: WorkspaceName;
  slug: WorkspaceSlug | null;
  avatarUrl: string | null;
  publication: Workspace["publication"];
}>;

/**
 * What the directory can say about one requested workspace.
 *
 * The three states are deliberately distinct: `deleted` is a durable
 * verdict a caller acts on by dropping the row, while `unavailable` says
 * only "not right now" and must keep the row visible in a degraded form.
 * Collapsing them would delete a workspace from a member's list because
 * one shard was briefly unreachable.
 *
 * `entry` carries the projection's source version so a caller comparing
 * it against a scope read can tell a stale projection from a current one
 * (spec/usecases/workspace.md `getPublicWorkspace` step 3).
 * `retryAfterSeconds` is a hint; `null` means the backend has no estimate.
 */
export type WorkspaceDirectoryResolution =
  | Readonly<{ state: "active"; entry: Versioned<WorkspaceDirectoryEntry> }>
  | Readonly<{ state: "deleted" }>
  | Readonly<{ state: "unavailable"; retryAfterSeconds: number | null }>;

/**
 * Shard-spanning batch read of directory rows for the WorkspaceIds of a
 * single page (max 20 input ids). Implementations group ids per
 * WorkspaceId hash shard and read in bounded waves (max 6 concurrent
 * connections); routing is direct from the input ids — never a full shard
 * scan, never a join over every workspace the caller belongs to. During a
 * reshard both generations are read and the higher source version wins
 * per WorkspaceId.
 *
 * **Every distinct input id appears exactly once in the returned map.**
 * This is the contract's difference from `UserBatchReader.resolveMany`,
 * which simply omits what it cannot find: a caller here renders one row
 * per membership edge and has to tell "this workspace is gone" from "the
 * directory cannot answer yet", so a missing key would be
 * indistinguishable from a deleted one. A row that has not been projected
 * yet resolves to `unavailable`, not to a missing key. Duplicate input
 * ids collapse into one entry; an empty input returns an empty map.
 *
 * A shard that cannot be read does **not** fail the call — its ids come
 * back `unavailable` while the other shards resolve normally. Partial
 * failure is the expected mode of a fan-out read of this width, and the
 * `unavailable` variant exists precisely so one failing shard degrades a
 * single row instead of the whole page.
 *
 * Error contract: `SystemError(DatabaseError)` — including an input over
 * the 20-id cap, which is a caller programming error rather than a
 * concurrent-state conflict (same contract as
 * `UserBatchReader.resolveMany`).
 */
export interface WorkspaceDirectoryBatchReader {
  resolveMany(
    ids: readonly WorkspaceId[],
  ): Promise<ReadonlyMap<WorkspaceId, WorkspaceDirectoryResolution>>;
}
