import { UserId } from "@repo/core/domain/identity/valueObject";
import { WorkspaceId } from "@repo/core/domain/workspace/valueObject";
import { NotFoundError } from "../errors";
import { ScopeKey } from "../scope";
import type { ServiceArgs } from "../types";
import type { WorkspaceAccessView } from "./view";

export type ResolveWorkspaceAccessInput = Readonly<{
  workspaceId: string;
  userId: string;
}>;

export const workspaceNotFound = (): NotFoundError =>
  new NotFoundError("WORKSPACE_NOT_FOUND", "Workspace not found");

/**
 * Resolves one user's role in one workspace (UC-workspace-001,
 * spec/usecases/workspace.md#resolveworkspaceaccess). Every operation
 * under a workspace calls this first.
 *
 * A non-member resolves to `role: null` rather than an error — the
 * caller decides whether that is fatal, since a public workspace page is
 * readable without a membership. An absent workspace is the one failure:
 * a workspace removed by the deletion saga leaves no row, so opening its
 * URL directly answers `WORKSPACE_NOT_FOUND` (WS-02).
 *
 * The membership read is the authorization source of truth; the global
 * `membership_directory` projection is never consulted here.
 */
export async function resolveWorkspaceAccess({
  container,
  input,
}: ServiceArgs<ResolveWorkspaceAccessInput>): Promise<WorkspaceAccessView> {
  const workspaceId = WorkspaceId.create(input.workspaceId);
  const userId = UserId.create(input.userId);

  const reader = container.workspaceReaderFor(ScopeKey.workspace(workspaceId));
  const stored = await reader.workspace.findById(workspaceId);
  if (stored === null) {
    throw workspaceNotFound();
  }

  const membership = await reader.membership.findByWorkspaceAndUser(
    workspaceId,
    userId,
  );

  return {
    workspaceId,
    role: membership?.entity.role ?? null,
    workspaceName: stored.entity.name,
    publication: stored.entity.publication,
  };
}
