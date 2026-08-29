import { UserId } from "@repo/core/domain/identity/valueObject";
import type { WorkspaceDirectoryResolution } from "@repo/core/domain/workspace/ports/workspaceDirectoryBatchReader";
import type { WorkspaceId } from "@repo/core/domain/workspace/valueObject";
import type { ServiceArgs } from "../types";
import type { UserWorkspaceListView, UserWorkspaceView } from "./view";

export type ListUserWorkspacesInput = Readonly<{
  userId: string;
  cursor?: string | null;
  limit?: number;
}>;

const DEFAULT_LIMIT = 20;

/**
 * The directory contracts for one resolution per distinct input id, so a
 * missing key is a backend defect. Degrading it to `unavailable` keeps
 * the page renderable instead of turning a projection gap into a
 * whole-list failure.
 */
const UNRESOLVED: WorkspaceDirectoryResolution = {
  state: "unavailable",
  retryAfterSeconds: null,
};

/**
 * Lists the workspaces the signed-in user belongs to, for the workspace
 * switcher (UC-workspace-015,
 * spec/usecases/workspace.md#listuserworkspaces).
 *
 * One keyset page of the user's own UserId shard, then a single
 * shard-spanning batch read for the page's display data — never a join
 * over every membership and never a name sort, because the directory's
 * `created_at DESC, workspace_id` order is what keeps a cursor valid
 * across a workspace rename.
 *
 * The three directory verdicts are kept apart: `deleted` drops the row,
 * `unavailable` keeps it in degraded form, and `active` renders it. The
 * role comes from the directory edge and is a projection, written by the
 * `workspace.membership.roleChanged` subscriber
 * (`./membershipRoleProjection`) — every mutation re-reads `Membership`
 * in the workspace scope, so an edge that lags is a display gap and
 * never a privilege.
 *
 * `limit` is validated by the directory port, which raises
 * `ValidationError("INVALID_PAGINATION")` for a value outside 1–20, an
 * unreadable cursor, or a retired routing generation.
 */
export async function listUserWorkspaces({
  container,
  input,
}: ServiceArgs<ListUserWorkspacesInput>): Promise<UserWorkspaceListView> {
  const userId = UserId.create(input.userId);
  const page = await container.userWorkspaceDirectory.listActiveByUser(
    userId,
    input.cursor ?? null,
    input.limit ?? DEFAULT_LIMIT,
  );

  const ids: WorkspaceId[] = [
    ...new Set(page.items.map((edge) => edge.workspaceId)),
  ];
  const resolved =
    await container.workspaceDirectoryBatchReader.resolveMany(ids);

  const workspaces: UserWorkspaceView[] = [];
  for (const edge of page.items) {
    const resolution = resolved.get(edge.workspaceId) ?? UNRESOLVED;
    switch (resolution.state) {
      case "deleted":
        break;
      case "unavailable":
        workspaces.push({
          status: "unavailable",
          workspaceId: edge.workspaceId,
          role: edge.role,
          retryAfterSeconds: resolution.retryAfterSeconds,
        });
        break;
      case "active":
        workspaces.push({
          status: "active",
          workspaceId: edge.workspaceId,
          name: resolution.entry.entity.name,
          slug: resolution.entry.entity.slug,
          avatarUrl: resolution.entry.entity.avatarUrl,
          role: edge.role,
          publication: resolution.entry.entity.publication,
        });
        break;
    }
  }

  return {
    workspaces,
    nextCursor: page.nextCursor,
    hasMore: page.nextCursor !== null,
  };
}
