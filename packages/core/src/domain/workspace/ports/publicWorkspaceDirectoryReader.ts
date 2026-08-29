import type { ShardPage } from "@repo/core/domain/common/pagination";
import type { WorkspaceId, WorkspaceSlug } from "../valueObject";

/**
 * One published workspace as the sitemap needs it. `slug` is non-null by
 * construction — a published workspace always has one
 * (`PublishedWorkspace`), and the enumeration only returns published rows.
 */
export type PublicWorkspaceEntry = Readonly<{
  workspaceId: WorkspaceId;
  slug: WorkspaceSlug;
  updatedAt: Date;
}>;

/**
 * Whole-service enumeration of published workspaces over the global
 * `workspace_directory`, for sitemap generation. Up to 32 WorkspaceId
 * hash shards are read in waves of at most 6 concurrent connections and
 * merged into a single page of at most `limit` items (default 100, max
 * 200).
 *
 * The predicate is `publication === "published"` **and** an active
 * lifecycle — a workspace whose deletion has begun leaves the public
 * enumeration immediately, before its rows are gone. It is re-applied on
 * every read whatever cursor arrives: cursors are opaque (signed) values
 * carrying the routing generation and each shard's
 * `(updated_at DESC, workspace_id)` keyset position, and they are **not
 * authenticated** — a cursor decides where a page starts, never what it
 * may contain, so no caller may treat one as a capability. During a
 * reshard both generations are read and deduplicated by WorkspaceId with
 * the higher source version winning.
 *
 * No total count is computed at any width; the caller iterates
 * `nextCursor` until it is `null`, which is the only signal that the
 * enumeration is exhausted. Since the page type carries no degraded
 * variant, a shard that cannot be read surfaces as
 * `SystemError(DatabaseError)` rather than a silently short page — a
 * truncated sitemap would look exactly like a complete one.
 *
 * Error contract: `ValidationError("INVALID_PAGINATION")` (limit out of
 * range, unreadable cursor, or retired generation),
 * `SystemError(DatabaseError)`.
 */
export interface PublicWorkspaceDirectoryReader {
  listPublished(
    cursor: string | null,
    limit: number,
  ): Promise<ShardPage<PublicWorkspaceEntry>>;
}
