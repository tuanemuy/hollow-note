import type { UserWorkspaceEdge } from "@repo/core/domain/workspace/ports/userWorkspaceDirectory";
import type {
  WorkspaceDirectoryBatchReader,
  WorkspaceDirectoryEntry,
  WorkspaceDirectoryResolution,
} from "@repo/core/domain/workspace/ports/workspaceDirectoryBatchReader";

/**
 * One membership edge that survived the directory read, in the order the
 * directory enumeration handed it over.
 *
 * There is deliberately no `deleted` variant: that verdict is expressed by
 * the row's absence, so a caller cannot render a workspace the directory
 * has already tombstoned.
 */
export type ResolvedWorkspaceEdge =
  | Readonly<{
      state: "active";
      edge: UserWorkspaceEdge;
      entry: WorkspaceDirectoryEntry;
    }>
  | Readonly<{
      state: "unavailable";
      edge: UserWorkspaceEdge;
      retryAfterSeconds: number | null;
    }>;

/**
 * The directory contracts for one resolution per distinct input id, so a
 * missing key is a backend defect. Degrading it to `unavailable` keeps the
 * page renderable instead of turning a projection gap into a whole-list
 * failure — and never into a deletion, which is the one verdict a missing
 * key must not be read as.
 */
const UNRESOLVED: WorkspaceDirectoryResolution = {
  state: "unavailable",
  retryAfterSeconds: null,
};

/**
 * Resolves a page of membership edges against the global workspace
 * directory, keeping the three verdicts apart: `deleted` drops the row,
 * `unavailable` keeps it in degraded form, and `active` carries the
 * display projection.
 *
 * Shared by every list built from membership edges (`listUserWorkspaces`,
 * `getUsageSnapshot`) so the branch and the missing-key degradation exist
 * once. The lists differ in what they project from a surviving edge, never
 * in which edges survive.
 */
export async function resolveWorkspaceEdges(
  reader: WorkspaceDirectoryBatchReader,
  edges: readonly UserWorkspaceEdge[],
): Promise<readonly ResolvedWorkspaceEdge[]> {
  if (edges.length === 0) {
    return [];
  }
  const resolved = await reader.resolveMany([
    ...new Set(edges.map((edge) => edge.workspaceId)),
  ]);

  const rows: ResolvedWorkspaceEdge[] = [];
  for (const edge of edges) {
    const resolution = resolved.get(edge.workspaceId) ?? UNRESOLVED;
    switch (resolution.state) {
      case "deleted":
        break;
      case "unavailable":
        rows.push({
          state: "unavailable",
          edge,
          retryAfterSeconds: resolution.retryAfterSeconds,
        });
        break;
      case "active":
        rows.push({ state: "active", edge, entry: resolution.entry.entity });
        break;
    }
  }
  return rows;
}
