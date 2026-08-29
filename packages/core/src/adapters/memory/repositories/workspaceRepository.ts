import type { WorkspaceRepository } from "../../../domain/workspace/ports/workspaceRepository";
import type { WorkspaceId } from "../../../domain/workspace/valueObject";
import type { Workspace } from "../../../domain/workspace/workspace";
import type { ScopeStore } from "../store";
import { createOccRepository } from "../support";

export function createMemoryWorkspaceRepository(
  scope: ScopeStore,
): WorkspaceRepository {
  return createOccRepository<Workspace, WorkspaceId>(
    "workspaces",
    scope.workspaces,
  );
}
