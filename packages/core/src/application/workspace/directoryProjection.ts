import type { WorkspaceDirectorySnapshot } from "@repo/core/domain/workspace/ports/workspaceDirectoryProjectionWriter";
import type { Workspace } from "@repo/core/domain/workspace/workspace";
import type { RequestContainer } from "../di/types";
import { retryOnce } from "./invitation";

/**
 * Publishes a workspace's display row to the global `workspace_directory`
 * after its scope-local commit (spec/usecases/workspace.md
 * `createWorkspace` 手順 4 / `changeWorkspaceSlug` 手順 4).
 *
 * The whole row goes out rather than a patch, and `sourceVersion` is the
 * only order the projection knows: a snapshot at or below the stored
 * version writes nothing, so replaying one commit is free and a slower
 * commit can never overwrite a faster one. Handing the slug over is the
 * writer's job — `workspace_slug_reservations` is the authority on who
 * owns it — so the caller has no separate directory step for a rename.
 *
 * Retried once because nothing else repairs this projection today: a lost
 * response would leave the public route and every member's list showing a
 * state the scope has already moved past.
 */
export async function projectWorkspaceDirectory(
  container: RequestContainer,
  label: string,
  workspace: Workspace,
): Promise<void> {
  const snapshot: WorkspaceDirectorySnapshot = {
    workspaceId: workspace.id,
    name: workspace.name,
    slug: workspace.slug,
    avatarUrl: workspace.avatarUrl,
    publication: workspace.publication,
    sourceVersion: workspace.version,
  };
  await retryOnce(container.logger, label, async () => {
    await container.workspaceDirectoryProjectionWriter.applySnapshotIfNewer(
      snapshot,
    );
  });
}
