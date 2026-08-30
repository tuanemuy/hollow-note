import type { WorkspaceId, WorkspaceName, WorkspaceSlug } from "../valueObject";
import type { Workspace } from "../workspace";

/**
 * What one apply writes into the global `workspace_directory`: the whole
 * display row, plus the aggregate version it was derived from.
 *
 * The snapshot is complete rather than a patch. The sender resolves the
 * current `name` / `slug` / `publication` from the Workspace it just
 * committed and writes all of them at once — a partial write would let
 * two applies landing out of order leave a row that never existed in the
 * scope.
 */
export type WorkspaceDirectorySnapshot = Readonly<{
  workspaceId: WorkspaceId;
  name: WorkspaceName;
  slug: WorkspaceSlug | null;
  avatarUrl: string | null;
  publication: Workspace["publication"];
  /** The Workspace version this snapshot was read at. */
  sourceVersion: number;
}>;

/**
 * Writer of the global `workspace_directory` projection, the counterpart
 * of the three readers that serve the workspace list, the batch display
 * read and the sitemap.
 *
 * Both methods are called by name, never by a subscriber: no event drives
 * this projection. `applySnapshotIfNewer` is sent synchronously by the
 * request that just committed — workspace creation, profile update, slug
 * change, publish and unpublish each send their own, right after their
 * scope-local commit — and is therefore best-effort, since nothing
 * re-sends a snapshot whose response was lost; the row stays behind until
 * the user's next save. `tombstone` is sent by the worker half of the
 * deletion saga. Convergence under repeated and out-of-order arrival is
 * still required of both — a sender may repeat its own call, and two
 * senders may overlap — so neither may assume a sequence.
 *
 * `sourceVersion` is what orders them. A snapshot at or below the stored
 * version is ignored, which is both the stale rule and the lost-response
 * rule: sending the same snapshot a second time writes nothing and leaves
 * the row the winner produced. Of two concurrent applies the higher
 * version wins whichever arrives second, because the comparison is
 * against the stored row rather than against what the caller last read.
 *
 * A tombstone is terminal. Once `tombstone` has run, no snapshot may
 * reopen the row at any version — a `deleted` verdict the batch reader
 * hands out is durable, and resurrecting a deleted workspace into a
 * member's list (or into the sitemap) is the failure this rule exists to
 * prevent.
 *
 * `slug` is unique across the projection, and the writer takes it rather
 * than failing: applying a snapshot that carries a slug first clears that
 * slug from any **other** row still holding it, in the same write.
 * `WorkspaceSlugReservationStore` is the authority on who owns a slug, so
 * a projection row still showing one that another workspace has since
 * reserved is stale by definition, and a projection write that could fail
 * on it would stall on a row nothing is going to send again.
 *
 * Taking the slug and applying the snapshot are one step: a snapshot that
 * writes nothing — stale, or against a tombstone — releases nothing. A
 * release that outlived its apply would leave a third workspace with no
 * slug and no one holding it, silently out of the sitemap until its own
 * next apply.
 *
 * Error contract: `ConflictError` (a row already tombstoned by another
 * deletion), `SystemError(DatabaseError)`.
 */
export interface WorkspaceDirectoryProjectionWriter {
  /**
   * Upserts the row when `sourceVersion` is greater than the stored one.
   * A stale snapshot, and any snapshot against a tombstone, writes
   * nothing.
   *
   * Nothing is answered. Whether this particular call was the one that
   * wrote is not knowable to every backend — a guarded upsert that
   * affected no row is indistinguishable from one that did where the
   * driver reports no row count — and no caller needs it: the row
   * converges on the highest version regardless of who applied it.
   *
   * The row's `updatedAt` (the sitemap's keyset order) is stamped by the
   * backend clock at apply time, not carried in the snapshot: it orders
   * projection applies, and a source instant would order them by a call
   * whose arrival may be arbitrarily late.
   */
  applySnapshotIfNewer(snapshot: WorkspaceDirectorySnapshot): Promise<void>;
  /**
   * Turns the row into the deletion tombstone: `lifecycle = 'deleting'`
   * under `operationId`, with the slug released and the display fields
   * redacted, so the public route stops resolving immediately while the
   * `deleted` verdict survives for the batch reader.
   *
   * Inserts the tombstone when no row was ever projected, so a workspace
   * deleted before its creation snapshot landed still answers `deleted`
   * rather than `unavailable` forever.
   *
   * Idempotent for `operationId`: a row this deletion already tombstoned
   * succeeds without moving, which is how a lost response is repaired. A
   * row tombstoned by a **different** operation is a `ConflictError` —
   * deletion is terminal and single-owner, so a second one naming the
   * same workspace is a routing fault, not a retry.
   */
  tombstone(
    input: Readonly<{ workspaceId: WorkspaceId; operationId: string }>,
  ): Promise<void>;
}
