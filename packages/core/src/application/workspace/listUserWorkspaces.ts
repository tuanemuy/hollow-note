import { UserId } from "@repo/core/domain/identity/valueObject";
import type { ServiceArgs } from "../types";
import { resolveWorkspaceEdges } from "./directoryResolution";
import type { UserWorkspaceListView, UserWorkspaceView } from "./view";

export type ListUserWorkspacesInput = Readonly<{
  userId: string;
  cursor?: string | null;
  limit?: number;
}>;

const DEFAULT_LIMIT = 20;

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
 * The three directory verdicts are kept apart by `./directoryResolution`:
 * `deleted` drops the row, `unavailable` keeps it in degraded form, and
 * `active` renders it. The role comes from the directory edge and is a
 * projection, written by the `workspace.membership.roleChanged` subscriber
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

  const rows = await resolveWorkspaceEdges(
    container.workspaceDirectoryBatchReader,
    page.items,
  );

  const workspaces = rows.map(
    (row): UserWorkspaceView =>
      row.state === "unavailable"
        ? {
            status: "unavailable",
            workspaceId: row.edge.workspaceId,
            role: row.edge.role,
            retryAfterSeconds: row.retryAfterSeconds,
          }
        : {
            status: "active",
            workspaceId: row.edge.workspaceId,
            name: row.entry.name,
            slug: row.entry.slug,
            avatarUrl: row.entry.avatarUrl,
            role: row.edge.role,
            publication: row.entry.publication,
          },
  );

  return {
    workspaces,
    nextCursor: page.nextCursor,
    hasMore: page.nextCursor !== null,
  };
}
