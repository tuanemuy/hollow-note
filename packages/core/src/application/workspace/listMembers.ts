import { BusinessRuleError } from "@repo/core/domain/error";
import type { User } from "@repo/core/domain/identity/user";
import type { UserId } from "@repo/core/domain/identity/valueObject";
import { WorkspaceErrorCode } from "@repo/core/domain/workspace/errorCode";
import { WorkspaceAuthorization } from "@repo/core/domain/workspace/services/workspaceAuthorization";
import { WorkspaceId } from "@repo/core/domain/workspace/valueObject";
import { ScopeKey } from "../scope";
import type { ServiceArgs } from "../types";
import { resolvePagination } from "./pagination";
import { resolveWorkspaceAccess } from "./resolveWorkspaceAccess";
import {
  type MemberDisplay,
  toWorkspaceMemberView,
  type WorkspaceMemberListView,
} from "./view";

export type ListMembersInput = Readonly<{
  workspaceId: string;
  userId: string;
  page?: number;
  limit?: number;
}>;

const DEFAULT_LIMIT = 50;

const displayOf = (user: User | undefined): MemberDisplay | null =>
  user === undefined || user.status === "deleted"
    ? null
    : {
        displayName: user.displayName,
        email: user.email,
        avatarUrl: user.avatarUrl,
      };

/**
 * Lists a workspace's members for the member management screen
 * (UC-workspace-013, spec/usecases/workspace.md#listmembers).
 *
 * Any member may read the list; `canManage` tells the screen whether to
 * offer the role / removal controls, so the read and the permission to
 * act on it stay separate decisions. `ownerCount` is read exactly, not
 * derived from the page, because the last-owner rule is judged against
 * the whole workspace.
 *
 * Display data is resolved through the identity plane's batch reader,
 * which omits ids it cannot answer; a member whose account is gone still
 * renders as a row with no display fields rather than failing the page.
 */
export async function listMembers({
  container,
  input,
}: ServiceArgs<ListMembersInput>): Promise<WorkspaceMemberListView> {
  const pagination = resolvePagination(input, DEFAULT_LIMIT);
  const access = await resolveWorkspaceAccess({
    container,
    input: { workspaceId: input.workspaceId, userId: input.userId },
  });
  if (access.role === null) {
    throw new BusinessRuleError(
      WorkspaceErrorCode.InsufficientRole,
      "Only a member can list the workspace members",
    );
  }

  const workspaceId = WorkspaceId.create(input.workspaceId);
  const reader = container.workspaceReaderFor(ScopeKey.workspace(workspaceId));
  const [page, ownerCount] = await Promise.all([
    reader.membership.listByWorkspace(workspaceId, pagination),
    reader.membership.countByRole(workspaceId, "owner"),
  ]);

  const userIds: UserId[] = [
    ...new Set(page.items.map((membership) => membership.userId)),
  ];
  const users = await container.userBatchReader.resolveMany(userIds);

  return {
    members: page.items.map((membership) =>
      toWorkspaceMemberView(
        membership,
        displayOf(users.get(membership.userId)?.entity),
      ),
    ),
    count: page.count,
    ownerCount,
    canManage: WorkspaceAuthorization.can(access.role, "manageMembers"),
  };
}
